import { describe, expect, it, vi } from 'vitest';
import type { GhClient } from './gh.ts';
import type { ManifestFlowDeps } from './loopback.ts';
import { chooseTarget, provisionAppFresh } from './provision-app.ts';

const fakeGh = (over: Partial<GhClient> = {}): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' })),
  ...over,
});

describe('chooseTarget', () => {
  it('maps an org login to an org target', async () => {
    expect(await chooseTarget('myorg', fakeGh())).toEqual({ kind: 'org', org: 'myorg' });
  });
  it('maps "personal" and absence to a personal target', async () => {
    expect(await chooseTarget('personal', fakeGh())).toEqual({ kind: 'personal' });
    expect(await chooseTarget(undefined, fakeGh())).toEqual({ kind: 'personal' });
  });
});

describe('provisionAppFresh', () => {
  it('builds the manifest for owner/repo, runs the flow with gh.appConversion, returns creds', async () => {
    const creds = { appId: 42, pem: '-----BEGIN…', slug: 'waiver-stamp-o' };
    const runFlow = vi.fn(async (deps: ManifestFlowDeps) => {
      expect(deps.manifest.url).toBe('https://github.com/o/r');
      expect(deps.manifest.name).toBe('waiver-stamp-o');
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
