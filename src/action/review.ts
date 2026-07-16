import * as core from '@actions/core';
import type { Outcome } from './decide.ts';

type Octokit = ReturnType<typeof import('@actions/github').getOctokit>;

/**
 * Login this token posts reviews as, or null if it can't be resolved.
 *
 * GET /user only works for user-to-server tokens (PAT / OAuth). An App installation token
 * 403s there — it represents no user — so fall back to GET /app: the app posts as `<slug>[bot]`.
 * Identity only drives the stale-review self-heal below, so unresolvable → skip it, never throw.
 */
async function resolveReviewerLogin(octokit: Octokit): Promise<string | null> {
  try {
    return (await octokit.rest.users.getAuthenticated()).data.login;
  } catch {
    try {
      const app = (await octokit.rest.apps.getAuthenticated()).data;
      return app?.slug ? `${app.slug}[bot]` : null;
    } catch {
      return null;
    }
  }
}

/** Submit the review (if any), bind it to headSha, self-heal our own stale REQUEST_CHANGES. */
export async function postOutcome(
  octokit: Octokit,
  args: { owner: string; repo: string; prNumber: number; headSha: string; outcome: Outcome },
): Promise<void> {
  const { owner, repo, prNumber: pull_number, headSha, outcome } = args;
  const me = await resolveReviewerLogin(octokit);

  // Self-heal: clear our own stale CHANGES_REQUESTED unless we're posting a new one.
  // No resolvable identity ⇒ can't match our own reviews ⇒ skip healing, still post below.
  if (me && outcome.action !== 'REQUEST_CHANGES') {
    const reviews = (await octokit.rest.pulls.listReviews({ owner, repo, pull_number })).data;
    for (const r of reviews) {
      if (r.user?.login === me && r.state === 'CHANGES_REQUESTED') {
        // Isolate dismiss failures: a transient rejection here must not skip the createReview
        // below and silently drop a legitimate APPROVE/COMMENT.
        try {
          await octokit.rest.pulls.dismissReview({
            owner,
            repo,
            pull_number,
            review_id: r.id,
            message: 'superseded — re-verified',
          });
        } catch (err) {
          core.warning(
            `waiver-stamp-review: failed to dismiss stale review ${r.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  // The default GITHUB_TOKEN authenticates as github-actions[bot]; GitHub blocks that identity
  // from approving PRs, and even a posted bot APPROVE wouldn't count toward required reviews. About
  // to APPROVE as it ⇒ the App-token wiring (setup step 8) is missing or was dropped in a refactor.
  // Say so — the raw API error ("GitHub Actions is not permitted to approve pull requests") is opaque.
  if (outcome.action === 'APPROVE' && me === 'github-actions[bot]') {
    core.warning(
      'waiver-stamp-review: about to APPROVE as the default GitHub Actions identity ' +
        '(github-actions[bot]). GitHub blocks that identity from approving PRs and would not count ' +
        'the review anyway. The App-token wiring (environment + create-github-app-token step + ' +
        'github-token input) is missing or was dropped — see docs/auto-approval-setup.md step 8.',
    );
  }

  if (outcome.action !== 'NONE') {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      commit_id: headSha,
      event: outcome.action,
      body: outcome.body,
    });
  }
}
