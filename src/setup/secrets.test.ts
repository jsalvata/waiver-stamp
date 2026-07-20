import { describe, expect, it, vi } from 'vitest';
import type { GhClient } from './gh.ts';
import { provisionSecrets } from './secrets.ts';

const fakeGh = (): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' })),
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
