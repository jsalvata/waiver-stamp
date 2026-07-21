import { describe, expect, it, vi } from 'vitest';
import type { GhClient } from '../setup/gh.ts';
import { type SetupDeps, setupRepository } from './setup-repository.ts';

const ctx = { owner: 'jsalvata', repo: 'demo', defaultBranch: 'main' };

const fakeGh = (): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' })),
  tokenScopes: vi.fn(async () => ['repo', 'admin:org']),
  viewerLogin: vi.fn(async () => 'jsalvata'),
  accountType: vi.fn(async () => 'User' as const),
});

function makeDeps(over: Partial<SetupDeps> = {}): SetupDeps {
  return {
    preflight: vi.fn(async () => ctx),
    gh: fakeGh(),
    resolveTarget: vi.fn(async () => ({ kind: 'personal' as const })),
    provisionAppFresh: vi.fn(async () => ({
      appId: 42,
      pem: '-----BEGIN…',
      slug: 'waiver-stamp-jsalvata',
    })),
    provisionSecrets: vi.fn(async () => {}),
    openBrowser: vi.fn(async () => {}),
    info: vi.fn(),
    ...over,
  };
}

describe('setupRepository', () => {
  it('runs preflight and reports the resolved context', async () => {
    const info = vi.fn();
    await setupRepository({ cwd: '/repo' }, makeDeps({ info }));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('jsalvata/demo'));
  });

  it('provisions the App and secrets, then guides install in the same tab', async () => {
    const provisionSecrets = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    const info = vi.fn();
    await setupRepository({ cwd: '/repo' }, makeDeps({ provisionSecrets, openBrowser, info }));
    expect(provisionSecrets).toHaveBeenCalledOnce();
    // provisionAppFresh (mocked here) owns the single browser open; the orchestrator must not
    // spawn a second install tab — the done page forwards to install in that same tab.
    expect(openBrowser).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/install/i));
  });

  it('an org-owned repo without the admin:org scope fails before creating the App', async () => {
    const provisionAppFresh = vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' }));
    const gh: GhClient = { ...fakeGh(), tokenScopes: vi.fn(async () => ['repo', 'read:org']) };
    const err = await setupRepository(
      { cwd: '/repo' },
      makeDeps({
        resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
        gh,
        provisionAppFresh,
      }),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'SetupError', message: expect.stringMatching(/admin:org/) });
    expect(provisionAppFresh).not.toHaveBeenCalled();
  });

  it('an org-owned repo with the admin:org scope proceeds to provisioning', async () => {
    const provisionAppFresh = vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' }));
    const gh: GhClient = { ...fakeGh(), tokenScopes: vi.fn(async () => ['repo', 'admin:org']) };
    await setupRepository(
      { cwd: '/repo' },
      makeDeps({
        resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
        gh,
        provisionAppFresh,
      }),
    );
    expect(provisionAppFresh).toHaveBeenCalledOnce();
  });

  it('--no-app skips provisioning entirely', async () => {
    const provisionAppFresh = vi.fn(async () => ({ appId: 0, pem: '', slug: '' }));
    const provisionSecrets = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    await setupRepository(
      { cwd: '/repo', noApp: true },
      makeDeps({ provisionAppFresh, provisionSecrets, openBrowser }),
    );
    expect(provisionAppFresh).not.toHaveBeenCalled();
    expect(provisionSecrets).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
