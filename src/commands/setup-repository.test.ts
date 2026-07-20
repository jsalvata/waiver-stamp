import { describe, expect, it, vi } from 'vitest';
import type { GhClient } from '../setup/gh.ts';
import { type SetupDeps, setupRepository } from './setup-repository.ts';

const ctx = { owner: 'jsalvata', repo: 'demo', defaultBranch: 'main' };

const fakeGh = (): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' })),
});

function makeDeps(over: Partial<SetupDeps> = {}): SetupDeps {
  return {
    preflight: vi.fn(async () => ctx),
    gh: fakeGh(),
    chooseTarget: vi.fn(async () => ({ kind: 'personal' as const })),
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

  it('provisions the App and secrets, then opens the install URL (happy path)', async () => {
    const provisionSecrets = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    await setupRepository(
      { cwd: '/repo', target: 'personal' },
      makeDeps({ provisionSecrets, openBrowser }),
    );
    expect(provisionSecrets).toHaveBeenCalledOnce();
    expect(openBrowser).toHaveBeenCalledWith(
      'https://github.com/apps/waiver-stamp-jsalvata/installations/new',
    );
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
