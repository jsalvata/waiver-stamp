import { describe, expect, it, vi } from 'vitest';
import { makeResolveRequiredChecks } from './resolve-checks.ts';

vi.mock('./discover-checks.ts', () => ({ discoverRequiredChecks: vi.fn() }));
vi.mock('../git.ts', () => ({ fileAtRef: vi.fn() }));
import { fileAtRef } from '../git.ts';
import { discoverRequiredChecks } from './discover-checks.ts';

const octokit = {} as never;
const args = { owner: 'o', repo: 'r', base: 'b'.repeat(40), repoDir: '/tmp/x' };

function setup(discovered: string[], config: object | null) {
  vi.mocked(discoverRequiredChecks).mockResolvedValue(discovered);
  vi.mocked(fileAtRef).mockResolvedValue(config === null ? null : JSON.stringify(config));
}

describe('makeResolveRequiredChecks (autodiscovery)', () => {
  it('returns the discovered set, self-excluding waiver-stamp', async () => {
    setup(['build', 'waiver-stamp', 'assay'], {});
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r.required).toEqual(['build', 'assay']);
  });
  it('lockfileHonestyConfigured true when the base config names a discovered required check', async () => {
    setup(['build', 'assay'], { lockfileHonestyCheck: 'assay' });
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r.lockfileHonestyConfigured).toBe(true);
  });
  it('lockfileHonestyConfigured false when the named check is not required (fail-safe)', async () => {
    setup(['build'], { lockfileHonestyCheck: 'assay' });
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r.lockfileHonestyConfigured).toBe(false);
  });
  it('lockfileHonestyConfigured false when the field is unset', async () => {
    setup(['build', 'assay'], {});
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r.lockfileHonestyConfigured).toBe(false);
  });
  it('falls back to the ci-checks override when discovery is empty (no-App path)', async () => {
    setup([], {});
    const r = await makeResolveRequiredChecks({ ciChecks: ['build'], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r.required).toEqual(['build']);
  });
  it('bumpingAllowed true when the base config lists an allowBumping entry', async () => {
    setup(['build'], { allowBumping: ['lodash'] });
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r.bumpingAllowed).toBe(true);
  });
  it('bumpingAllowed false when allowBumping is empty or unset', async () => {
    setup(['build'], { allowBumping: [] });
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r.bumpingAllowed).toBe(false);

    setup(['build'], {});
    const r2 = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(r2.bumpingAllowed).toBe(false);
  });
});
