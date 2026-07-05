import type { Outcome } from './decide.ts';

type Octokit = ReturnType<typeof import('@actions/github').getOctokit>;

/** Submit the review (if any), bind it to headSha, self-heal our own stale REQUEST_CHANGES. */
export async function postOutcome(
  octokit: Octokit,
  args: { owner: string; repo: string; prNumber: number; headSha: string; outcome: Outcome },
): Promise<void> {
  const { owner, repo, prNumber: pull_number, headSha, outcome } = args;
  const me = (await octokit.rest.users.getAuthenticated()).data.login;

  // Self-heal: clear our own stale CHANGES_REQUESTED unless we're posting a new one.
  if (outcome.action !== 'REQUEST_CHANGES') {
    const reviews = (await octokit.rest.pulls.listReviews({ owner, repo, pull_number })).data;
    for (const r of reviews) {
      if (r.user?.login === me && r.state === 'CHANGES_REQUESTED') {
        await octokit.rest.pulls.dismissReview({
          owner,
          repo,
          pull_number,
          review_id: r.id,
          message: 'superseded — re-verified',
        });
      }
    }
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
