import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import { postOutcome } from './review.ts';

// review.ts calls core.warning directly; mock the module so it's assertable
// (vi.spyOn can't redefine @actions/core's read-only exports).
vi.mock('@actions/core', () => ({ warning: vi.fn() }));

/** 403 shape Octokit surfaces for a token that can't reach an endpoint. */
function forbidden(): never {
  throw Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
}

/** GitHub's 422 refusing an APPROVE from an identity it forbids (the default GITHUB_TOKEN). */
function forbiddenApprove(): Error {
  return Object.assign(
    new Error(
      'Unprocessable Entity: "GitHub Actions is not permitted to approve pull requests." - ' +
        'https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request',
    ),
    { status: 422 },
  );
}

function octokitSpy(
  existingReviews: Array<{ id: number; user: { login: string }; state: string }> = [],
  // Only user-to-server tokens (PAT/OAuth) answer GET /user. Installation tokens — the default
  // GITHUB_TOKEN and create-github-app-token outputs alike — 403 there and have no "who am I"
  // endpoint at all, so the default identity here is unresolvable, matching every Actions run.
  identity: { user?: string } = {},
) {
  const createReview = vi.fn(
    async (_a: { event: string; body: string; commit_id: string }) => ({}),
  );
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
        users: {
          getAuthenticated: async () =>
            identity.user ? { data: { login: identity.user } } : forbidden(),
        },
      },
    } as never,
  };
}

const args = { owner: 'o', repo: 'r', prNumber: 7, headSha: 'a'.repeat(40) };

describe('postOutcome', () => {
  it('submits an APPROVE bound to the head SHA when GitHub permits it (App-token path)', async () => {
    const s = octokitSpy();
    vi.mocked(core.warning).mockClear();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.createReview).toHaveBeenCalledTimes(1);
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'APPROVE', commit_id: args.headSha }),
    );
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('falls back to a COMMENT (and warns) when GitHub refuses the APPROVE', async () => {
    const s = octokitSpy();
    s.createReview.mockRejectedValueOnce(forbiddenApprove());
    vi.mocked(core.warning).mockClear();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'stamped' } });
    expect(s.createReview).toHaveBeenCalledTimes(2);
    expect(s.createReview).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: 'COMMENT', commit_id: args.headSha }),
    );
    // The comment keeps the verdict body and explains why it isn't an approval.
    const body = s.createReview.mock.calls[1]?.[0]?.body ?? '';
    expect(body).toContain('stamped');
    expect(body).toContain('Approve');
    // Still tells the maintainer how to make approval automatic.
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('App token'));
  });

  it('propagates non-approve-permission failures (fail-closed upstream)', async () => {
    const s = octokitSpy();
    s.createReview.mockRejectedValueOnce(
      Object.assign(new Error('Unprocessable Entity: "Commit not found"'), { status: 422 }),
    );
    await expect(
      postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } }),
    ).rejects.toThrow('Commit not found');
    expect(s.createReview).toHaveBeenCalledTimes(1);
  });

  it('NONE submits no review', async () => {
    const s = octokitSpy();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'NONE', body: '' } });
    expect(s.createReview).not.toHaveBeenCalled();
  });

  it('COMMENT outcomes post unchanged, without warnings', async () => {
    const s = octokitSpy();
    vi.mocked(core.warning).mockClear();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'COMMENT', body: 'partial' } });
    expect(s.createReview).toHaveBeenCalledTimes(1);
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'COMMENT', body: 'partial' }),
    );
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('on a non-REQUEST_CHANGES outcome, dismisses its own prior REQUEST_CHANGES (PAT identity)', async () => {
    const s = octokitSpy([{ id: 42, user: { login: 'release-bot' }, state: 'CHANGES_REQUESTED' }], {
      user: 'release-bot',
    });
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
  });

  it("does not dismiss a human's CHANGES_REQUESTED review", async () => {
    const s = octokitSpy(
      [{ id: 99, user: { login: 'a-human-reviewer' }, state: 'CHANGES_REQUESTED' }],
      { user: 'release-bot' },
    );
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).not.toHaveBeenCalled();
  });

  it('an unresolvable identity (installation token) skips self-healing but still posts', async () => {
    const s = octokitSpy([
      { id: 42, user: { login: 'my-reviewer[bot]' }, state: 'CHANGES_REQUESTED' },
    ]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.createReview).toHaveBeenCalledWith(expect.objectContaining({ event: 'APPROVE' }));
    expect(s.dismissReview).not.toHaveBeenCalled();
  });

  it('a dismiss failure is isolated: still submits the new review', async () => {
    const s = octokitSpy([{ id: 42, user: { login: 'release-bot' }, state: 'CHANGES_REQUESTED' }], {
      user: 'release-bot',
    });
    s.dismissReview.mockRejectedValueOnce(new Error('transient API error'));
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ commit_id: args.headSha }),
    );
  });
});
