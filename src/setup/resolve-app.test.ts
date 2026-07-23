import { describe, expect, it, vi } from 'vitest';
import type { GhClient } from './gh.ts';
import type { AppCredentials } from './loopback.ts';
import { type ResolveAppDeps, resolveApp } from './resolve-app.ts';
import { SECRET_NAMES } from './secrets.ts';

const FRESH: AppCredentials = { appId: 9, pem: 'FRESH-PEM', slug: 'waiver-stamp-o' };

/** Reuse keys on presence alone, so visibility is irrelevant here — pick one and move on. */
const sel = (names: readonly string[]) =>
  names.map((name) => ({ name, visibility: 'selected' as const }));

const fakeGh = (over: Partial<GhClient> = {}): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => FRESH),
  tokenScopes: vi.fn(async () => ['admin:org']),
  viewerLogin: vi.fn(async () => 'jsalvata'),
  accountType: vi.fn(async () => 'User' as const),
  orgSecrets: vi.fn(async () => []),
  repoSecretNames: vi.fn(async () => []),
  grantOrgSecretRepo: vi.fn(async () => {}),
  orgAppSlugs: vi.fn(async () => []),
  listRulesets: vi.fn(async () => []),
  createRuleset: vi.fn(async () => {}),
  fileExistsOnRef: vi.fn(async () => false),
  ...over,
});

const deps = (over: Partial<ResolveAppDeps> = {}): ResolveAppDeps => ({
  target: { kind: 'personal' },
  owner: 'o',
  repo: 'r',
  gh: fakeGh(),
  openBrowser: vi.fn(async () => {}),
  confirmSaveKey: vi.fn(async () => false),
  provisionAppFresh: vi.fn(async () => FRESH),
  readDiskApp: vi.fn(async () => null),
  writeDiskApp: vi.fn(async () => {}),
  info: vi.fn(),
  ...over,
});

describe('resolveApp — org', () => {
  const orgTarget = { kind: 'org', org: 'acme' } as const;

  it('reuses when both org secrets are already set: no manifest flow, no pem', async () => {
    const d = deps({
      target: orgTarget,
      gh: fakeGh({
        orgSecrets: vi.fn(async () => sel([...SECRET_NAMES, 'UNRELATED'])),
        orgAppSlugs: vi.fn(async () => ['dependabot', 'waiver-stamp-acme']),
      }),
    });
    expect(await resolveApp(d)).toEqual({ source: 'reuse-org', slug: 'waiver-stamp-acme' });
    expect(d.provisionAppFresh).not.toHaveBeenCalled();
  });

  // Re-minting would overwrite the org secret and break every repo already installed on the old
  // App, so a missing/renamed installation must not push us back onto the fresh path.
  it('still reuses when no matching installation is visible — just without a slug', async () => {
    const d = deps({
      target: orgTarget,
      gh: fakeGh({ orgSecrets: vi.fn(async () => sel([...SECRET_NAMES])) }),
    });
    expect(await resolveApp(d)).toEqual({ source: 'reuse-org' });
    expect(d.provisionAppFresh).not.toHaveBeenCalled();
  });

  it('provisions fresh when only one of the two secrets exists (half-configured org)', async () => {
    const d = deps({
      target: orgTarget,
      gh: fakeGh({ orgSecrets: vi.fn(async () => sel([SECRET_NAMES[0]])) }),
    });
    expect(await resolveApp(d)).toEqual({ ...FRESH, source: 'fresh' });
  });

  it('never reads or writes the disk store for an org target', async () => {
    const d = deps({ target: orgTarget });
    await resolveApp(d);
    expect(d.readDiskApp).not.toHaveBeenCalled();
    expect(d.writeDiskApp).not.toHaveBeenCalled();
    expect(d.confirmSaveKey).not.toHaveBeenCalled();
  });
});

describe('resolveApp — personal', () => {
  it('loads a saved key from disk instead of running the manifest flow', async () => {
    const saved: AppCredentials = { appId: 3, pem: 'DISK-PEM', slug: 'renamed-by-hand' };
    const d = deps({ readDiskApp: vi.fn(async () => saved) });
    expect(await resolveApp(d)).toEqual({ ...saved, source: 'disk' });
    expect(d.provisionAppFresh).not.toHaveBeenCalled();
  });

  it('provisions fresh and persists when the user opts in', async () => {
    const d = deps({ confirmSaveKey: vi.fn(async () => true) });
    expect(await resolveApp(d)).toEqual({ ...FRESH, source: 'fresh' });
    expect(d.writeDiskApp).toHaveBeenCalledWith('o', FRESH);
  });

  it('provisions fresh and persists nothing when the user declines (secure default)', async () => {
    const d = deps({ confirmSaveKey: vi.fn(async () => false) });
    expect(await resolveApp(d)).toEqual({ ...FRESH, source: 'fresh' });
    expect(d.writeDiskApp).not.toHaveBeenCalled();
  });

  // The answer picks the App's name, so it has to be known before the manifest is built.
  it('asks about saving before minting, since the answer names the App', async () => {
    const order: string[] = [];
    const d = deps({
      confirmSaveKey: vi.fn(async () => {
        order.push('ask');
        return true;
      }),
      provisionAppFresh: vi.fn(async () => {
        order.push('flow');
        return FRESH;
      }),
    });
    await resolveApp(d);
    expect(order).toEqual(['ask', 'flow']);
  });

  it('mints an account-wide App when the key will be saved', async () => {
    const d = deps({ confirmSaveKey: vi.fn(async () => true) });
    await resolveApp(d);
    expect(d.provisionAppFresh).toHaveBeenCalledWith(
      expect.objectContaining({ dedicated: false, owner: 'o', repo: 'r' }),
    );
  });

  // Without a saved key the account-wide name may already be taken by an earlier repo, and App
  // names are globally unique — so a declined save must ask GitHub for a repo-specific name.
  it('mints an App dedicated to this repo when the key will not be saved', async () => {
    const d = deps({ confirmSaveKey: vi.fn(async () => false) });
    await resolveApp(d);
    expect(d.provisionAppFresh).toHaveBeenCalledWith(
      expect.objectContaining({ dedicated: true, owner: 'o', repo: 'r' }),
    );
  });
});
