import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { fetchArtifact, makeResolvePr } from './adapters.ts';
import { confirmChecksGreen } from './backstop.ts';
import { decideReview } from './decide.ts';
import type { Outcome } from './decide.ts';
import { g1WorkflowIntegrity, g2ManifestEnvelope } from './guards.ts';
import { parseList } from './inputs.ts';
import { postOutcome } from './review.ts';
import type { ArtifactReport } from './schema.ts';

type Octokit = ReturnType<typeof getOctokit>;

export interface RunDeps {
  context: {
    payload: {
      workflow_run: {
        head_sha: string;
        head_branch: string;
        repository: { owner: { login: string }; name: string };
      };
    };
  };
  getOctokit: () => Octokit;
  resolvePr: (
    owner: string,
    repo: string,
    headSha: string,
  ) => Promise<{ number: number; base: string } | null>;
  confirmChecksGreen: (
    octokit: Octokit,
    args: { owner: string; repo: string; headSha: string; required: readonly string[] },
  ) => Promise<{ ok: boolean; pending: string[]; failed: string[] }>;
  fetchArtifact: (
    octokit: Octokit,
    owner: string,
    repo: string,
    headSha: string,
  ) => Promise<ArtifactReport | null>;
  g1: (repo: string, base: string, head: string) => Promise<string[]>;
  g2: (repo: string, base: string, head: string) => Promise<string[]>;
  postOutcome: (
    octokit: Octokit,
    args: { owner: string; repo: string; prNumber: number; headSha: string; outcome: Outcome },
  ) => Promise<void>;
  inputs: { ciChecks: string[]; lockfileHonestyChecks: string[] };
  repoDir?: string;
}

/** Orchestrate one `workflow_run` wake-up. Fail-closed: any error → no review, no crash. */
export async function run(deps: RunDeps): Promise<void> {
  try {
    const wr = deps.context.payload.workflow_run;
    const owner = wr.repository.owner.login;
    const repo = wr.repository.name;
    const headSha = wr.head_sha;
    const octokit = deps.getOctokit();

    const pr = await deps.resolvePr(owner, repo, headSha);
    if (!pr) return core.info('no open PR for head SHA — nothing to do');

    const required = [...deps.inputs.ciChecks, ...deps.inputs.lockfileHonestyChecks];
    const backstop = await deps.confirmChecksGreen(octokit, { owner, repo, headSha, required });
    if (!backstop.ok)
      return core.info(
        `backstop not green (pending=${backstop.pending}, failed=${backstop.failed}) — no-op`,
      );

    const artifact = await deps.fetchArtifact(octokit, owner, repo, headSha);
    // pr.base is authoritative (GitHub API); artifact.head/base are attacker-influenceable.
    if (!artifact || artifact.head !== headSha || artifact.base !== pr.base)
      return core.info('artifact missing or SHA mismatch — fail-closed');

    // Guards run base..head off pr.base, never artifact.base. If pr.base isn't reachable from
    // the checked-out default branch, g1/g2 throw and the outer catch fails closed — acceptable.
    const dir = deps.repoDir ?? process.cwd();
    const guardsPass =
      (await deps.g1(dir, pr.base, headSha)).length === 0 &&
      (await deps.g2(dir, pr.base, headSha)).length === 0;

    const outcome = decideReview({
      verdict: artifact.verdict,
      guardsPass,
      backstopGreen: true,
      lockfileHonestyConfigured: deps.inputs.lockfileHonestyChecks.length > 0,
    });
    await deps.postOutcome(octokit, { owner, repo, prNumber: pr.number, headSha, outcome });
  } catch (err) {
    // Fail-closed: log, never post a verdict, never crash the workflow into a red required check.
    core.warning(
      `waiver-stamp-review errored, no review posted: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ncc entry: invoke unless imported by a test.
if (process.env.VITEST === undefined) {
  const inputs = {
    ciChecks: parseList(core.getInput('ci-checks')),
    lockfileHonestyChecks: parseList(core.getInput('lockfile-honesty-checks')),
  };
  const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
  const octokit = getOctokit(token);

  run({
    // The real webhook payload for a workflow_run event; @actions/github's Context types
    // `payload` generically, so narrow it to the shape RunDeps needs.
    context: context as unknown as RunDeps['context'],
    getOctokit: () => octokit,
    resolvePr: makeResolvePr(octokit),
    confirmChecksGreen,
    fetchArtifact,
    g1: g1WorkflowIntegrity,
    g2: g2ManifestEnvelope,
    postOutcome,
    inputs,
  }).catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
}
