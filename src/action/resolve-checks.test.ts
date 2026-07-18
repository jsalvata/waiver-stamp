import { describe, expect, it } from 'vitest';
import { makeResolveRequiredChecks } from './resolve-checks.ts';

const octokit = {} as never;
const args = { owner: 'o', repo: 'r', base: 'b'.repeat(40), repoDir: '/tmp/x' };

describe('makeResolveRequiredChecks (static inputs — PR 0 behavior)', () => {
  it('unions ciChecks and lockfileHonestyChecks into the required set', async () => {
    const resolve = makeResolveRequiredChecks({
      ciChecks: ['CI'],
      lockfileHonestyChecks: ['assay'],
    });
    const r = await resolve(octokit, args);
    expect(r.required).toEqual(['CI', 'assay']);
  });
  it('lockfileHonestyConfigured is true iff the honesty list is non-empty', async () => {
    const on = await makeResolveRequiredChecks({
      ciChecks: ['CI'],
      lockfileHonestyChecks: ['assay'],
    })(octokit, args);
    const off = await makeResolveRequiredChecks({ ciChecks: ['CI'], lockfileHonestyChecks: [] })(
      octokit,
      args,
    );
    expect(on.lockfileHonestyConfigured).toBe(true);
    expect(off.lockfileHonestyConfigured).toBe(false);
  });
});
