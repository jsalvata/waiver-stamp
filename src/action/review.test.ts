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

/** A stale blocking review as a previous run posted it — the body carries the marker. */
const STALE_OWN_RC = {
  id: 42,
  user: { login: 'github-actions[bot]' },
  state: 'CHANGES_REQUESTED',
  body: 'waiver-stamp: the trusted layer refuted this APPROVE claim (a `.github/**` or out-of-envelope manifest change). Full human review applies.',
};

function octokitSpy(
  existingReviews: Array<{
    id: number;
    user: { login: string };
    state: string;
    body: string;
  }> = [],
) {
  const createReview = vi.fn(
    async (_a: { event: string; body: string; commit_id: string }) => ({}),
  );
  const dismissReview = vi.fn(async () => ({}));
  // Only user-to-server tokens (PAT/OAuth) answer GET /user. Installation tokens — the default
  // GITHUB_TOKEN and create-github-app-token outputs alike — 403 there and have no "who am I"
  // endpoint at all, so this models every real Actions run: an identity lookup never answers.
  const getAuthenticated = vi.fn(async () => forbidden());
  // The real endpoint pages (30 per page, oldest first); only octokit.paginate sees past page 1.
  const listReviews = async (p: { page?: number; per_page?: number }) => {
    const per = p.per_page ?? 30;
    const page = p.page ?? 1;
    return { data: existingReviews.slice((page - 1) * per, page * per) };
  };
  const paginate = async (
    fn: typeof listReviews,
    params: Record<string, unknown>,
  ): Promise<unknown[]> => {
    const all: unknown[] = [];
    for (let page = 1; ; page++) {
      const { data } = await fn({ ...params, page });
      all.push(...data);
      if (data.length < 30) return all;
    }
  };
  return {
    createReview,
    dismissReview,
    getAuthenticated,
    octokit: {
      paginate,
      rest: {
        pulls: {
          listReviews,
          createReview,
          dismissReview,
        },
        users: { getAuthenticated },
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

  it('dismisses its own stale REQUEST_CHANGES by body marker — no identity lookup', async () => {
    const s = octokitSpy([
      STALE_OWN_RC,
      {
        id: 7,
        user: { login: 'github-actions[bot]' },
        state: 'APPROVED',
        body: 'waiver-stamp: every commit is mechanically stamped — this PR is fully accounted for.',
      },
      {
        id: 99,
        user: { login: 'a-human-reviewer' },
        state: 'CHANGES_REQUESTED',
        body: 'blocking: please add tests',
      },
    ]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledTimes(1);
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
    expect(s.createReview).toHaveBeenCalledWith(expect.objectContaining({ event: 'APPROVE' }));
    // The whole point: installation tokens can't answer "who am I", so it's never asked.
    expect(s.getAuthenticated).not.toHaveBeenCalled();
  });

  it("a human's CHANGES_REQUESTED quoting the bot's body is not dismissed", async () => {
    const s = octokitSpy([
      {
        id: 99,
        user: { login: 'a-human-reviewer' },
        state: 'CHANGES_REQUESTED',
        body: `> ${STALE_OWN_RC.body}\n\nI disagree — still blocking.`,
      },
    ]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).not.toHaveBeenCalled();
  });

  it('NONE still heals stale reviews, without posting anything', async () => {
    const s = octokitSpy([STALE_OWN_RC]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'NONE', body: '' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
    expect(s.createReview).not.toHaveBeenCalled();
  });

  it('heals even when the APPROVE is refused and falls back to a COMMENT', async () => {
    const s = octokitSpy([STALE_OWN_RC]);
    s.createReview.mockRejectedValueOnce(forbiddenApprove());
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'stamped' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
    expect(s.createReview).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'COMMENT' }));
  });

  it('a REQUEST_CHANGES outcome does not heal — the new complaint stands on its own', async () => {
    const s = octokitSpy([STALE_OWN_RC]);
    await postOutcome(s.octokit, {
      ...args,
      outcome: { action: 'REQUEST_CHANGES', body: 'waiver-stamp: refuted' },
    });
    expect(s.dismissReview).not.toHaveBeenCalled();
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REQUEST_CHANGES' }),
    );
  });

  it('heals a stale review beyond the first page of 30', async () => {
    // Reviews list oldest-first, so on a long-lived PR the stale block is precisely the
    // review most likely to sit past page 1.
    const priorRuns = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      user: { login: 'github-actions[bot]' },
      state: 'COMMENTED',
      body: 'waiver-stamp: some commits are mechanically stamped; the rest still need a human.',
    }));
    const s = octokitSpy([...priorRuns, { ...STALE_OWN_RC, id: 31 }]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledTimes(1);
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 31 }));
  });

  it('a dismiss failure is isolated: still submits the new review', async () => {
    const s = octokitSpy([STALE_OWN_RC]);
    s.dismissReview.mockRejectedValueOnce(new Error('transient API error'));
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
    expect(s.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ commit_id: args.headSha }),
    );
  });
});
