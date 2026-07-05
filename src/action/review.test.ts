import { describe, expect, it, vi } from 'vitest';
import { postOutcome } from './review.ts';

function octokitSpy(
  existingReviews: Array<{ id: number; user: { login: string }; state: string }> = [],
) {
  const createReview = vi.fn(async () => ({}));
  const dismissReview = vi.fn(async () => ({}));
  return {
    createReview,
    dismissReview,
    octokit: {
      rest: {
        pulls: {
          listReviews: async () => ({ data: existingReviews }),
          createReview,
          dismissReview,
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: vi.fn(async () => ({})),
          updateComment: vi.fn(),
        },
        users: { getAuthenticated: async () => ({ data: { login: 'github-actions[bot]' } }) },
      },
    } as never,
  };
}

const args = { owner: 'o', repo: 'r', prNumber: 7, headSha: 'a'.repeat(40) };

describe('postOutcome', () => {
  it('submits an APPROVE review bound to the head SHA', async () => {
    const s = octokitSpy();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'APPROVE', commit_id: args.headSha }),
    );
  });
  it('on a non-REQUEST_CHANGES outcome, dismisses its own prior REQUEST_CHANGES', async () => {
    const s = octokitSpy([
      { id: 42, user: { login: 'github-actions[bot]' }, state: 'CHANGES_REQUESTED' },
    ]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
  });
  it('NONE submits no review', async () => {
    const s = octokitSpy();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'NONE', body: '' } });
    expect(s.createReview).not.toHaveBeenCalled();
  });
});
