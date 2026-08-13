import * as core from '@actions/core';
import { type Outcome, REVIEW_BODY_MARKER } from './decide.ts';

type Octokit = ReturnType<typeof import('@actions/github').getOctokit>;

/** GitHub's 422 refusing an APPROVE from an identity it forbids (the default GITHUB_TOKEN). */
function isForbiddenApprove(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown };
  return e?.status === 422 && /not permitted to approve/i.test(String(e?.message ?? ''));
}

/** Submit the review (if any), bind it to headSha, self-heal our own stale REQUEST_CHANGES. */
export async function postOutcome(
  octokit: Octokit,
  args: { owner: string; repo: string; prNumber: number; headSha: string; outcome: Outcome },
): Promise<void> {
  const { owner, repo, prNumber: pull_number, headSha, outcome } = args;

  // Self-heal: clear our own stale CHANGES_REQUESTED unless we're posting a new one.
  // "Our own" is matched by the body marker every outcome embeds, not by login: on real
  // Actions runs the token's identity is unresolvable (see REVIEW_BODY_MARKER), and the
  // marker also matches reviews a previous run posted under a different token identity.
  // Prefix-anchored so a human review quoting ours (`> waiver-stamp:…`) never matches.
  if (outcome.action !== 'REQUEST_CHANGES') {
    // Paginated: reviews list oldest-first, so on a PR with 30+ reviews the stale block is
    // exactly the review a single-page fetch would miss.
    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number,
    });
    for (const r of reviews) {
      if (r.state === 'CHANGES_REQUESTED' && r.body.startsWith(REVIEW_BODY_MARKER)) {
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

  if (outcome.action === 'NONE') return;

  // Whether this token may APPROVE is undiscoverable up front: an installation token's identity
  // is unresolvable (above), and even github-actions[bot] can approve where the repo's "allow
  // GitHub Actions to approve pull requests" setting is on. So attempt the APPROVE and let GitHub
  // decide; when it refuses (422, the default-GITHUB_TOKEN path), post the same verdict as a
  // COMMENT rather than nothing. The App-token wiring (environment + create-github-app-token
  // step + github-token input) is what makes a real APPROVE stick (§4.9 / setup step 8).
  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      commit_id: headSha,
      event: outcome.action,
      body: outcome.body,
    });
  } catch (err) {
    if (outcome.action !== 'APPROVE' || !isForbiddenApprove(err)) throw err;
    core.warning(
      'waiver-stamp-review: GitHub refused the APPROVE — this token (usually the default ' +
        'GITHUB_TOKEN, github-actions[bot]) is not permitted to approve PRs — posting a COMMENT ' +
        'instead. Wire the App token (environment + create-github-app-token step + github-token ' +
        'input) to make approval automatic; see docs/auto-approval-setup.md step 8.',
    );
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      commit_id: headSha,
      event: 'COMMENT',
      body: `${outcome.body}\n\n> ℹ️ Posted as a comment, not an approval: this workflow's token can't approve PRs, so a human still needs to click **Approve**. [Make this automatic.](https://github.com/jsalvata/waiver-stamp/blob/main/docs/auto-approval-setup.md#adopter-checklist)`,
    });
  }
}
