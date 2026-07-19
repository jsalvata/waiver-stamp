/**
 * Real Octokit-backed collaborators for `run()` (§4.2). Not unit-tested here — the DI seam in
 * `main.ts` lets `main.test.ts` exercise the orchestration against fakes; these adapters are
 * exercised end-to-end by the acceptance harness (§10) against real GitHub API responses.
 */
import { strFromU8, unzipSync } from 'fflate';
import { parseArtifact } from './schema.ts';
import type { ArtifactReport } from './schema.ts';

type Octokit = ReturnType<typeof import('@actions/github').getOctokit>;

const REPORT_ARTIFACT_NAME = 'waiver-stamp-report';
const REPORT_FILE_NAME = 'waiver-stamp-report.json';

/**
 * The open PR (if any) whose current head is `headSha`. Takes its own Octokit (the `RunDeps`
 * seam doesn't thread one through — `resolvePr` runs before the rest of the pipeline needs it).
 */
export function makeResolvePr(octokit: Octokit) {
  return async (
    owner: string,
    repo: string,
    headSha: string,
  ): Promise<{ number: number; base: string; baseRef: string } | null> => {
    const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: headSha,
    });
    const pr = prs.find((p) => p.state === 'open');
    return pr ? { number: pr.number, base: pr.base.sha, baseRef: pr.base.ref } : null;
  };
}

/**
 * Find the `waiver-stamp` producer run for `headSha` (the triggering `workflow_run` may be a
 * different backstop workflow, e.g. CI), download its `waiver-stamp-report` artifact, and
 * zod-validate it. No matching run/artifact → null; a malformed artifact (bad zip, bad JSON,
 * schema mismatch) throws via `parseArtifact` — either way `run()`'s outer catch fails closed.
 */
export async function fetchArtifact(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
): Promise<ArtifactReport | null> {
  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    head_sha: headSha,
    per_page: 100,
  });

  for (const wfRun of data.workflow_runs) {
    const { data: artifacts } = await octokit.rest.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: wfRun.id,
      per_page: 100,
    });
    const artifact = artifacts.artifacts.find((a) => a.name === REPORT_ARTIFACT_NAME && !a.expired);
    if (!artifact) continue;

    const { data: zipData } = await octokit.rest.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: artifact.id,
      archive_format: 'zip',
    });
    const zip = unzipSync(new Uint8Array(zipData as ArrayBuffer));
    const reportBytes = zip[REPORT_FILE_NAME];
    if (!reportBytes) continue;

    return parseArtifact(strFromU8(reportBytes));
  }
  return null;
}
