/**
 * PR-level rubber-stamp (§17.2): walk base..head, classify each commit by its embedded
 * waiver, and aggregate to a single verdict. Only APPROVE removes review.
 */
import { commitsInRange, resolveCommit } from './git.js';
import type { PerCommitResult, Verdict, VerifyReport } from './report.js';
import { classifyCommit } from './verify.js';

export interface StampRangeOptions {
  base: string;
  head: string;
  /** Repo path. Defaults to process.cwd(). */
  cwd?: string;
}

export async function stamp(options: StampRangeOptions): Promise<VerifyReport> {
  const cwd = options.cwd ?? process.cwd();
  // Resolve refs up front: an unresolvable --base/--head is a malformed
  // invocation (§10 → exit 2, via CommitResolutionError), not an internal error.
  const base = await resolveCommit(cwd, options.base);
  const head = await resolveCommit(cwd, options.head);
  const shas = await commitsInRange(cwd, base, head);
  const commits: PerCommitResult[] = [];
  for (const sha of shas) commits.push(await classifyCommit(cwd, sha));
  return { verdict: aggregate(commits), commits };
}

/** Highest-severity verdict present: REQUEST_CHANGES > COMMENT > APPROVE > ABSTAIN (§17.2). */
export function aggregate(commits: readonly PerCommitResult[]): Verdict {
  const hasInvalid = commits.some((c) => c.class === 'invalid');
  const hasStamped = commits.some((c) => c.class === 'stamped');
  const hasUnwaivered = commits.some((c) => c.class === 'unwaivered');
  if (hasInvalid) return 'REQUEST_CHANGES';
  if (hasStamped && hasUnwaivered) return 'COMMENT';
  if (hasStamped) return 'APPROVE';
  return 'ABSTAIN';
}
