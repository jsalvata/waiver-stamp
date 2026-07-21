import { describe, expect, it, vi } from 'vitest';
import type { GhClient, SecretVisibility } from './gh.ts';
import { SECRET_NAMES, grantExistingOrgSecrets, provisionSecrets } from './secrets.ts';

const visible = (visibility: SecretVisibility) =>
  SECRET_NAMES.map((name) => ({ name, visibility }));

const fakeGh = (over: Partial<GhClient> = {}): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' })),
  tokenScopes: vi.fn(async () => ['admin:org']),
  viewerLogin: vi.fn(async () => 'jsalvata'),
  accountType: vi.fn(async () => 'User' as const),
  orgSecrets: vi.fn(async () => visible('selected')),
  repoSecretNames: vi.fn(async () => []),
  grantOrgSecretRepo: vi.fn(async () => {}),
  orgAppSlugs: vi.fn(async () => []),
  ...over,
});

describe('provisionSecrets', () => {
  it('writes exactly the two namespaced secrets at repo scope for a personal target', async () => {
    const gh = fakeGh();
    await provisionSecrets(gh, {
      target: { kind: 'personal' },
      appId: 42,
      pem: 'PEM',
      owner: 'o',
      repo: 'r',
    });
    expect(gh.setSecret).toHaveBeenCalledTimes(2);
    expect(gh.setSecret).toHaveBeenNthCalledWith(1, {
      name: 'WAIVER_STAMP_APP_ID',
      value: '42',
      scope: 'repo',
      repo: 'o/r',
    });
    expect(gh.setSecret).toHaveBeenNthCalledWith(2, {
      name: 'WAIVER_STAMP_APP_PRIVATE_KEY',
      value: 'PEM',
      scope: 'repo',
      repo: 'o/r',
    });
  });

  it('writes both secrets at org scope for an org target, scoped to the repo', async () => {
    const gh = fakeGh();
    await provisionSecrets(gh, {
      target: { kind: 'org', org: 'acme' },
      appId: 7,
      pem: 'PEM',
      owner: 'acme',
      repo: 'demo',
    });
    expect(gh.setSecret).toHaveBeenCalledTimes(2);
    const names = (gh.setSecret as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].name);
    expect(names).toEqual(['WAIVER_STAMP_APP_ID', 'WAIVER_STAMP_APP_PRIVATE_KEY']);
    for (const [arg] of (gh.setSecret as ReturnType<typeof vi.fn>).mock.calls) {
      expect(arg.scope).toBe('org');
      expect(arg.org).toBe('acme');
      expect(arg.repo).toBe('acme/demo');
    }
  });
});

describe('grantExistingOrgSecrets', () => {
  const args = (info = vi.fn()) => ({ org: 'acme', owner: 'acme', repo: 'demo', info });

  // The reuse path has no pem, so it can't rewrite the secrets — it can only widen their
  // selected-repositories list to include the repo being set up.
  it('adds the repo to both selected-visibility secrets without touching their values', async () => {
    const gh = fakeGh();
    await grantExistingOrgSecrets(gh, args());
    expect(gh.setSecret).not.toHaveBeenCalled();
    expect(gh.grantOrgSecretRepo).toHaveBeenNthCalledWith(
      1,
      'acme',
      'WAIVER_STAMP_APP_ID',
      'acme/demo',
    );
    expect(gh.grantOrgSecretRepo).toHaveBeenNthCalledWith(
      2,
      'acme',
      'WAIVER_STAMP_APP_PRIVATE_KEY',
      'acme/demo',
    );
  });

  // At `all` the repo can already read the secret, and the grant endpoint only accepts `selected`
  // — so granting would 409 on a configuration that works.
  it('skips the grant at `all` visibility and flags how wide the key is', async () => {
    const gh = fakeGh({ orgSecrets: vi.fn(async () => visible('all')) });
    const info = vi.fn();
    await grantExistingOrgSecrets(gh, args(info));
    expect(gh.grantOrgSecretRepo).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('every repository in acme'));
  });

  it('skips the grant at `private` visibility and says public repos will not see it', async () => {
    const gh = fakeGh({ orgSecrets: vi.fn(async () => visible('private')) });
    const info = vi.fn();
    await grantExistingOrgSecrets(gh, args(info));
    expect(gh.grantOrgSecretRepo).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('private'));
  });
});
