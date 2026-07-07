/**
 * Shared fixture shape for the e2e acceptance harness (`bench/e2e/run.ts`). Each fixture
 * describes a small sequence of commits to seed on a branch off the sandbox base, plus the
 * exact review outcome `run.ts` must observe once the deployed `waiver-stamp` +
 * `waiver-stamp-review` workflows have processed the resulting PR (design §5 / spec §17.2).
 */

/** One commit to create on the fixture branch, applied in order. */
export interface FixtureCommit {
  /** Full commit message (subject + body), including any embedded ```waiver block. */
  message: string;
  /** Repo-relative path -> full file contents, written before `git add -A && git commit`. */
  files: Record<string, string>;
}

/**
 * What `run.ts` must observe on the PR once both workflows have settled. Only one of
 * `approve` / `comment` / `requestChanges` is ever true — `none` covers the fixtures whose
 * whole point is that the bot posts **no review at all** (honest `invalid`, `ABSTAIN`, and the
 * honest-producer G1 forgery, per design §5's "Nothing" rows).
 */
export type ExpectedOutcome =
  | { kind: 'approve' }
  | { kind: 'comment' }
  | { kind: 'requestChanges' }
  | { kind: 'none' };

/** The `waiver-stamp` check (a required-status producer, ci.yml) conclusion to expect. */
export type ExpectedCheckConclusion = 'success' | 'failure';

export interface Fixture {
  /** Short slug used to build the branch name (`e2e/<slug>-<runId>`) and PR title. */
  slug: string;
  /** One-line human description, echoed in run.ts's progress output and failure messages. */
  description: string;
  /** Commits to create on top of the sandbox base, in order. */
  commits: FixtureCommit[];
  /** The `waiver-stamp` producer check's expected conclusion on the final head SHA. */
  expectedCheckConclusion: ExpectedCheckConclusion;
  /** The `waiver-stamp-review` bot's expected review outcome on the PR. */
  expectedReview: ExpectedOutcome;
}
