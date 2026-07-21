import { describe, expect, it, vi } from 'vitest';
import type { GhClient } from './gh.ts';
import type { ManifestFlowDeps } from './loopback.ts';
import { provisionAppFresh, resolveTarget } from './provision-app.ts';

const fakeGh = (over: Partial<GhClient> = {}): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' })),
  tokenScopes: vi.fn(async () => ['admin:org']),
  viewerLogin: vi.fn(async () => 'jsalvata'),
  accountType: vi.fn(async () => 'User' as const),
  orgSecretNames: vi.fn(async () => []),
  grantOrgSecretRepo: vi.fn(async () => {}),
  orgAppSlugs: vi.fn(async () => []),
  ...over,
});

// The manifest registers a private App, and GitHub only lets a private App be installed on the
// account that owns it — so the App owner is *dictated* by the repo owner, never chosen.
describe('resolveTarget', () => {
  it('targets the org when the repo belongs to one', async () => {
    const gh = fakeGh({ accountType: vi.fn(async () => 'Organization' as const) });
    expect(await resolveTarget('acme', gh)).toEqual({ kind: 'org', org: 'acme' });
  });

  it('targets the personal account when the repo is the authenticated user’s own', async () => {
    expect(await resolveTarget('jsalvata', fakeGh())).toEqual({ kind: 'personal' });
    // No account-type lookup needed once the login matches.
    expect(await resolveTarget('JSalvata', fakeGh())).toEqual({ kind: 'personal' });
  });

  // Nothing we can create is installable here: an App owned by us can't go on their account, and
  // we can't create one owned by them.
  it('refuses a repo owned by a different user', async () => {
    const err = await resolveTarget('someone-else', fakeGh()).catch((e: unknown) => e);
    expect(err).toMatchObject({
      name: 'SetupError',
      message: expect.stringMatching(/someone-else/),
    });
  });

  it('fails loudly when the owner’s account type is unreadable', async () => {
    const gh = fakeGh({ accountType: vi.fn(async () => null) });
    await expect(resolveTarget('mystery', gh)).rejects.toMatchObject({ name: 'SetupError' });
  });

  it('fails loudly when the authenticated login is unreadable', async () => {
    const gh = fakeGh({ viewerLogin: vi.fn(async () => null) });
    await expect(resolveTarget('acme', gh)).rejects.toMatchObject({ name: 'SetupError' });
  });
});

describe('provisionAppFresh', () => {
  it('builds the manifest for owner/repo, runs the flow with gh.appConversion, returns creds', async () => {
    const creds = { appId: 42, pem: '-----BEGIN…', slug: 'waiver-stamp-o' };
    const runFlow = vi.fn(async (deps: ManifestFlowDeps) => {
      expect(deps.manifest.url).toBe('https://github.com/o/r');
      expect(deps.manifest.name).toBe('waiver-stamp-o');
      expect(deps.repoFullName).toBe('o/r');
      // convert delegates to gh.appConversion
      await deps.convert('code-xyz');
      return creds;
    });
    const gh = fakeGh();
    const result = await provisionAppFresh({
      target: { kind: 'personal' },
      owner: 'o',
      repo: 'r',
      gh,
      openBrowser: vi.fn(async () => {}),
      runFlow,
    });
    expect(result).toEqual(creds);
    expect(gh.appConversion).toHaveBeenCalledWith('code-xyz');
  });
});
