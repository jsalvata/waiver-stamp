import { describe, expect, it, vi } from 'vitest';
import { discoverRequiredChecks } from './discover-checks.ts';

function octo(handlers: Record<string, unknown | (() => never)>) {
  return {
    request: vi.fn(async (route: string) => {
      const h = handlers[route];
      if (typeof h === 'function') (h as () => never)(); // throw path
      return { data: h };
    }),
  } as never;
}
const RULES = 'GET /repos/{owner}/{repo}/rules/branches/{branch}';
const CLASSIC = 'GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks';
const throwing = () => {
  throw Object.assign(new Error('Not Found'), { status: 404 });
};
const throwingServerError = () => {
  throw Object.assign(new Error('boom'), { status: 500 });
};

describe('discoverRequiredChecks', () => {
  it('collects contexts from required_status_checks rules (incl. matrix legs)', async () => {
    const o = octo({
      [RULES]: [
        { type: 'pull_request', parameters: {} },
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [
              { context: 'build' },
              { context: 'integration (9.12.0)' },
              { context: 'integration (10.0.0)' },
            ],
          },
        },
      ],
      [CLASSIC]: throwing,
    });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual([
      'build',
      'integration (9.12.0)',
      'integration (10.0.0)',
    ]);
  });
  it('unions rules and classic when both are non-empty and disjoint', async () => {
    const o = octo({
      [RULES]: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'a' }] },
        },
      ],
      [CLASSIC]: { contexts: ['b'] },
    });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual(['a', 'b']);
  });
  it('unions and dedups overlapping contexts', async () => {
    const o = octo({
      [RULES]: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'a' }, { context: 'b' }] },
        },
      ],
      [CLASSIC]: { contexts: ['b', 'c'] },
    });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual(['a', 'b', 'c']);
  });
  it('rules non-empty, classic 404s → rules only', async () => {
    const o = octo({
      [RULES]: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'a' }] },
        },
      ],
      [CLASSIC]: throwing,
    });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual(['a']);
  });
  it('classic non-empty, rules 404s → classic only', async () => {
    const o = octo({ [RULES]: throwing, [CLASSIC]: { contexts: ['build'] } });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual(['build']);
  });
  it('returns [] when neither endpoint yields checks (both 404)', async () => {
    const o = octo({ [RULES]: throwing, [CLASSIC]: throwing });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual([]);
  });
  it('a non-404 error from a reader fails closed (rejects, no silent under-count)', async () => {
    const o = octo({ [RULES]: throwingServerError, [CLASSIC]: throwing });
    await expect(discoverRequiredChecks(o, 'o', 'r', 'main')).rejects.toThrow('boom');
  });
  it('a non-404 error rejects even when the other reader has checks (fail-closed, not a partial union)', async () => {
    const o = octo({ [RULES]: throwingServerError, [CLASSIC]: { contexts: ['build'] } });
    await expect(discoverRequiredChecks(o, 'o', 'r', 'main')).rejects.toThrow('boom');
  });
});
