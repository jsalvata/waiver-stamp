import { describe, expect, it } from 'vitest';
import { makeResolvePr } from './adapters.ts';

function octo(prs: Array<{ number: number; state: string; base: { ref: string; sha: string } }>) {
  return {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: async () => ({ data: prs }),
      },
    },
  } as never;
}

describe('makeResolvePr', () => {
  it('returns the base SHA and base ref (branch name) separately for the open PR', async () => {
    const octokit = octo([
      { number: 7, state: 'open', base: { ref: 'main', sha: 'b'.repeat(40) } },
    ]);
    const result = await makeResolvePr(octokit)('o', 'r', 'a'.repeat(40));
    expect(result).toEqual({ number: 7, base: 'b'.repeat(40), baseRef: 'main' });
  });
  it('no open PR → null', async () => {
    const octokit = octo([
      { number: 7, state: 'closed', base: { ref: 'main', sha: 'b'.repeat(40) } },
    ]);
    const result = await makeResolvePr(octokit)('o', 'r', 'a'.repeat(40));
    expect(result).toBeNull();
  });
});
