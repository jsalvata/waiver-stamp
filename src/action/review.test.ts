import { describe, expect, it, vi } from 'vitest';
import { postOutcome } from './review.ts';

/** 403 shape Octokit surfaces for a token that can't reach an endpoint. */
function forbidden(): never {
  throw Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
}

function octokitSpy(
  existingReviews: Array<{ id: number; user: { login: string }; state: string }> = [],
  identity: { user?: string; appSlug?: string } = { user: 'github-actions[bot]' },
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
        // A user/PAT token answers GET /user; an App installation token 403s there and
        // answers GET /app with the app slug instead.
        users: {
          getAuthenticated: async () =>
            identity.user ? { data: { login: identity.user } } : forbidden(),
        },
        apps: {
          getAuthenticated: async () =>
            identity.appSlug ? { data: { slug: identity.appSlug } } : forbidden(),
        },
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
  it("does not dismiss a human's CHANGES_REQUESTED review", async () => {
    const s = octokitSpy([
      { id: 99, user: { login: 'a-human-reviewer' }, state: 'CHANGES_REQUESTED' },
    ]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).not.toHaveBeenCalled();
  });
  it('with an App installation token (/user 403s), still submits the review', async () => {
    const s = octokitSpy([], { appSlug: 'my-reviewer' });
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'APPROVE', commit_id: args.headSha }),
    );
  });
  it('with an App token, self-heals its own stale review posted as <slug>[bot]', async () => {
    const s = octokitSpy(
      [{ id: 42, user: { login: 'my-reviewer[bot]' }, state: 'CHANGES_REQUESTED' }],
      { appSlug: 'my-reviewer' },
    );
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
  });
  it('when neither /user nor /app resolve, still submits without self-healing', async () => {
    const s = octokitSpy(
      [{ id: 42, user: { login: 'my-reviewer[bot]' }, state: 'CHANGES_REQUESTED' }],
      {},
    );
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.createReview).toHaveBeenCalledWith(expect.objectContaining({ event: 'APPROVE' }));
    expect(s.dismissReview).not.toHaveBeenCalled();
  });
  it('a dismiss failure is isolated: still submits the new review', async () => {
    const s = octokitSpy([
      { id: 42, user: { login: 'github-actions[bot]' }, state: 'CHANGES_REQUESTED' },
    ]);
    s.dismissReview.mockRejectedValueOnce(new Error('transient API error'));
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'APPROVE', commit_id: args.headSha }),
    );
  });
});
