/**
 * Real-PR e2e acceptance harness (spec §17.2/§18.3, design §5/§10, task-16).
 *
 * THIS IS A POST-MERGE ACCEPTANCE STEP — see `bench/e2e/README.md` for why and how to run
 * it. In short: `pull_request` and `workflow_run` triggers always execute the workflow
 * **definition that lives on the repo's default branch**, never a definition from the PR
 * branch itself. So there is no way to exercise "the deployed `waiver-stamp-review`
 * workflow reacting to a real PR" until this whole automation-layer feature has already
 * been merged to `main` — at that point, and only then, does opening a PR here actually
 * invoke the real, privileged reviewer action. This file is committed now, correct by
 * construction, and is not run as part of this branch's CI or test suite.
 *
 * For each fixture (`./fixtures/*.ts`) this script:
 *   1. creates a branch off the sandbox base (`e2e-sandbox-base`, itself branched from the
 *      repo's default branch so the fixtures' commits apply cleanly);
 *   2. applies the fixture's commits (each may embed a ```waiver block, spec §17.1) and
 *      pushes the branch;
 *   3. opens a real PR against the sandbox base via `gh pr create`;
 *   4. waits for the `waiver-stamp` producer check (ci.yml's `waiver-stamp` job) AND the
 *      `waiver-stamp-review` `workflow_run` to both complete on the PR's head SHA;
 *   5. reads the posted review via `gh pr view --json reviews` and the check conclusion via
 *      `gh pr checks`, and asserts both match the fixture's `expectedReview` /
 *      `expectedCheckConclusion` (see `./fixtures/types.ts`).
 *
 * A mismatch throws immediately (fail loud, not silently continue) so a broken assertion is
 * impossible to miss in the summary. Every fixture PR/branch is left open, whether the
 * fixture passed or failed, for inspection — see `bench/e2e/README.md` for how to clean them
 * up (a couple of `gh` one-liners; not this script's job).
 *
 * Usage: `tsx bench/e2e/run.ts` (needs `gh` authenticated against this repo, and push
 * access to create branches here — see the README's prerequisites).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { E2eHarnessError } from './errors.ts';
import { abstainFixture } from './fixtures/abstain.ts';
import { approveFixture } from './fixtures/approve.ts';
import { commentFixture } from './fixtures/comment.ts';
import { forgedApproveFixture } from './fixtures/forged-approve.ts';
import { g1ForgeryFixture } from './fixtures/g1-forgery.ts';
import { invalidFixture } from './fixtures/invalid.ts';
import { SANDBOX_BASE_FILES } from './fixtures/seed.ts';
import type { ExpectedOutcome, Fixture } from './fixtures/types.ts';

const exec = promisify(execFile);

const REPO = 'jsalvata/waiver-stamp';
const SANDBOX_BASE_BRANCH = 'e2e-sandbox-base';
/** The `waiver-stamp` producer job's check-run name (ci.yml's job id). */
const PRODUCER_CHECK_NAME = 'waiver-stamp';
/** How long to wait for both the producer check and the reviewer's workflow_run to settle. */
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 15 * 1000;

const FIXTURES: readonly Fixture[] = [
  approveFixture,
  commentFixture,
  invalidFixture,
  abstainFixture,
  g1ForgeryFixture,
  forgedApproveFixture,
];

/** Run a command, returning trimmed stdout; throws with stderr attached on non-zero exit. */
async function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new E2eHarnessError(
      'Command failed',
      { cmd, args, cwd, output: e.stderr || e.stdout || e.message || String(err) },
      { cause: err },
    );
  }
}

async function git(repoDir: string, args: string[]): Promise<string> {
  return run('git', args, repoDir);
}

async function gh(args: string[], cwd?: string): Promise<string> {
  return run('gh', args, cwd);
}

/** Write `files` into `repoDir`, stage, and commit with `message` (full subject+body). */
async function commitFiles(
  repoDir: string,
  files: Record<string, string>,
  message: string,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(repoDir, rel);
    await run('mkdir', ['-p', dirname(abs)]);
    await writeFile(abs, content, 'utf8');
  }
  await git(repoDir, ['add', '-A']);
  await git(repoDir, ['commit', '-m', message]);
}

/** Ensure `e2e-sandbox-base` exists on the remote, branched from the default branch. */
async function ensureSandboxBase(repoDir: string): Promise<void> {
  const exists = await gh([
    'api',
    `repos/${REPO}/branches/${SANDBOX_BASE_BRANCH}`,
    '--silent',
  ]).then(
    () => true,
    () => false,
  );
  if (exists) return;

  const defaultBranch = await gh([
    'repo',
    'view',
    REPO,
    '--json',
    'defaultBranchRef',
    '-q',
    '.defaultBranchRef.name',
  ]);
  await git(repoDir, ['fetch', 'origin', defaultBranch]);
  await git(repoDir, ['checkout', '-B', SANDBOX_BASE_BRANCH, `origin/${defaultBranch}`]);
  await commitFiles(
    repoDir,
    SANDBOX_BASE_FILES,
    'chore: seed e2e sandbox base\n\nA loadable TypeScript project the e2e fixtures branch from and rename\nagainst. See bench/e2e/README.md.\n',
  );
  await git(repoDir, ['push', 'origin', `${SANDBOX_BASE_BRANCH}:${SANDBOX_BASE_BRANCH}`]);
}

interface OpenedPr {
  number: number;
  headSha: string;
  branch: string;
}

/** Create the fixture's branch off the sandbox base, apply its commits, push, open the PR. */
async function openFixturePr(repoDir: string, runId: string, fixture: Fixture): Promise<OpenedPr> {
  const branch = `e2e/${fixture.slug}-${runId}`;
  await git(repoDir, ['fetch', 'origin', SANDBOX_BASE_BRANCH]);
  await git(repoDir, ['checkout', '-B', branch, `origin/${SANDBOX_BASE_BRANCH}`]);
  for (const commit of fixture.commits) await commitFiles(repoDir, commit.files, commit.message);
  await git(repoDir, ['push', 'origin', `${branch}:${branch}`]);
  const headSha = await git(repoDir, ['rev-parse', 'HEAD']);

  const prNumber = await gh([
    'pr',
    'create',
    '--repo',
    REPO,
    '--base',
    SANDBOX_BASE_BRANCH,
    '--head',
    branch,
    '--title',
    `e2e(${fixture.slug}): ${fixture.description}`,
    '--body',
    `Acceptance-harness fixture for \`waiver-stamp-review\` (task-16). Expected outcome: ${JSON.stringify(fixture.expectedReview)}. Safe to close/delete — see bench/e2e/README.md.`,
  ]).then((url) => {
    const match = /\/pull\/(\d+)/.exec(url);
    if (!match?.[1]) {
      throw new E2eHarnessError('Could not parse PR number from gh pr create output', { url });
    }
    return Number(match[1]);
  });

  return { number: prNumber, headSha, branch };
}

interface CheckRun {
  name: string;
  /** waiver-stamp's own expected-conclusion vocabulary; mapped from `gh`'s `bucket` field. */
  conclusion: 'success' | 'failure';
}

/**
 * Poll `gh pr checks --json name,bucket` until every check on the PR has a terminal
 * `bucket` (`pass`/`fail`/`skipping`/`cancel`, never `pending`), or timeout. `bucket` is
 * `gh`'s own normalized rollup of a check's raw status+conclusion — more stable to depend on
 * than the underlying GitHub Checks API's `status`/`conclusion` pair.
 */
async function waitForChecksSettled(prNumber: number): Promise<CheckRun[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const raw = await gh([
      'pr',
      'checks',
      String(prNumber),
      '--repo',
      REPO,
      '--json',
      'name,bucket',
    ]).catch(() => '[]');
    const rows = JSON.parse(raw || '[]') as { name: string; bucket: string }[];
    const pending = rows.filter((r) => r.bucket === 'pending');
    if (rows.length > 0 && pending.length === 0) {
      return rows.map((r) => ({
        name: r.name,
        conclusion: r.bucket === 'pass' ? 'success' : 'failure',
      }));
    }
    if (Date.now() > deadline) {
      throw new E2eHarnessError('Timed out waiting for PR checks to settle', {
        prNumber,
        timeoutMs: POLL_TIMEOUT_MS,
        stillPending: pending.map((r) => r.name),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

interface Review {
  state: string;
}

/**
 * Wait for the `waiver-stamp-review` bot to either post a review or settle into its
 * "no-op, nothing to do" steady state. There is no positive signal for "the bot decided not
 * to review" other than the trigger itself finishing — the review workflow is a
 * `workflow_run` reacting to `headSha`'s checks completing, so we poll for a
 * `waiver-stamp-review` run whose own `headSha` matches and wait for THAT run (not just any
 * run of the workflow) to reach `completed`, then read `reviews`.
 */
async function waitForReviewerSettled(prNumber: number, headSha: string): Promise<Review[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const runs = await gh([
      'run',
      'list',
      '--repo',
      REPO,
      '--workflow',
      'waiver-stamp-review',
      '--json',
      'status,headSha',
      '--limit',
      '20',
    ]).catch(() => '[]');
    const parsedRuns = JSON.parse(runs || '[]') as { status: string; headSha: string }[];
    const forThisSha = parsedRuns.filter((r) => r.headSha === headSha);
    const settled = forThisSha.length > 0 && forThisSha.every((r) => r.status === 'completed');
    if (settled) break;
    if (Date.now() > deadline) {
      throw new E2eHarnessError('Timed out waiting for waiver-stamp-review to run', {
        prNumber,
        headSha,
        timeoutMs: POLL_TIMEOUT_MS,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  const raw = await gh(['pr', 'view', String(prNumber), '--repo', REPO, '--json', 'reviews']);
  const parsed = JSON.parse(raw) as { reviews: Review[] };
  return parsed.reviews;
}

function outcomeFromReviews(reviews: Review[]): ExpectedOutcome {
  // The reviewer keeps a single active review, re-submitting or dismissing its own (design §6),
  // so the latest non-dismissed state IS the current outcome — no aggregation needed.
  const mine = reviews.filter((r) => r.state !== 'DISMISSED' && r.state !== 'PENDING');
  const last = mine[mine.length - 1];
  if (!last) return { kind: 'none' };
  if (last.state === 'APPROVED') return { kind: 'approve' };
  if (last.state === 'CHANGES_REQUESTED') return { kind: 'requestChanges' };
  if (last.state === 'COMMENTED') return { kind: 'comment' };
  return { kind: 'none' };
}

function assertOutcome(fixture: Fixture, actual: ExpectedOutcome): void {
  if (actual.kind !== fixture.expectedReview.kind) {
    throw new E2eHarnessError('Reviewer outcome did not match fixture expectation', {
      slug: fixture.slug,
      description: fixture.description,
      expected: fixture.expectedReview.kind,
      observed: actual.kind,
    });
  }
}

function assertCheckConclusion(fixture: Fixture, checks: CheckRun[]): void {
  const producer = checks.find((c) => c.name === PRODUCER_CHECK_NAME);
  if (!producer) {
    throw new E2eHarnessError('Producer check not found among the PR checks', {
      slug: fixture.slug,
      expectedCheckName: PRODUCER_CHECK_NAME,
      observedCheckNames: checks.map((c) => c.name),
    });
  }
  if (producer.conclusion !== fixture.expectedCheckConclusion) {
    throw new E2eHarnessError('Producer check conclusion did not match fixture expectation', {
      slug: fixture.slug,
      description: fixture.description,
      checkName: PRODUCER_CHECK_NAME,
      expected: fixture.expectedCheckConclusion,
      observed: producer.conclusion,
    });
  }
}

/**
 * Render an error for the terminal: the static message plus its structured `extra` (and, if
 * chained, its `cause`'s own message) — `E2eHarnessError` keeps `extra` out of the message
 * string itself (greppable, no interpolation), so the terminal print site is what stitches it
 * back together for a human to read.
 */
function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const extra = err instanceof E2eHarnessError && err.extra ? ` ${JSON.stringify(err.extra)}` : '';
  const cause =
    err.cause instanceof Error
      ? ` (cause: ${err.cause.message})`
      : err.cause
        ? ` (cause: ${err.cause})`
        : '';
  return `${err.message}${extra}${cause}`;
}

async function runFixture(repoDir: string, runId: string, fixture: Fixture): Promise<void> {
  process.stderr.write(`\n=== ${fixture.slug} — ${fixture.description} ===\n`);
  const pr = await openFixturePr(repoDir, runId, fixture);
  process.stderr.write(`opened PR #${pr.number} (${pr.branch} @ ${pr.headSha})\n`);

  const checks = await waitForChecksSettled(pr.number);
  process.stderr.write(
    `checks settled: ${checks.map((c) => `${c.name}=${c.conclusion}`).join(', ')}\n`,
  );
  assertCheckConclusion(fixture, checks);

  const reviews = await waitForReviewerSettled(pr.number, pr.headSha);
  const outcome = outcomeFromReviews(reviews);
  process.stderr.write(`reviewer outcome: ${outcome.kind}\n`);
  assertOutcome(fixture, outcome);

  process.stderr.write(`PASS: ${fixture.slug}\n`);
}

async function main(): Promise<void> {
  const runId = Date.now().toString(36);
  const repoDir = await mkdtemp(join(tmpdir(), 'ws-e2e-'));
  try {
    await git(repoDir, ['init', '-b', 'scratch']);
    await git(repoDir, ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
    await git(repoDir, ['config', 'user.email', 'e2e-harness@example.com']);
    await git(repoDir, ['config', 'user.name', 'waiver-stamp e2e harness']);

    await ensureSandboxBase(repoDir);

    const failures: string[] = [];
    for (const fixture of FIXTURES) {
      try {
        await runFixture(repoDir, runId, fixture);
      } catch (err) {
        process.stderr.write(`FAIL: ${fixture.slug}: ${formatError(err)}\n`);
        failures.push(fixture.slug);
      }
    }

    if (failures.length > 0) {
      throw new E2eHarnessError('One or more fixtures failed', {
        failedCount: failures.length,
        totalCount: FIXTURES.length,
        failedSlugs: failures,
      });
    }
    process.stderr.write(`\nAll ${FIXTURES.length} fixtures passed.\n`);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`e2e harness failed: ${formatError(err)}\n`);
  process.exitCode = 1;
});
