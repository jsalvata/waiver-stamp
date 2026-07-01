/**
 * Per-commit PR verification (spec §17.2). Walk `base..head`, classify each
 * commit by its embedded waiver, and aggregate to a single verdict. Only APPROVE
 * removes review; COMMENT/ABSTAIN leave normal review in force (downside-bound).
 */

import { extractWaiverBlock } from './commit-waiver.js';
import { commitMessage, commitSubject, commitsInRange, parents } from './git.js';
import type { PerCommitResult, Verdict, VerifyReport } from './report.js';
import { stampWaiver } from './stamp.js';

export interface VerifyOptions {
  base: string;
  head: string;
  /** Repo path where `base`/`head` live. Defaults to `process.cwd()`. */
  cwd?: string;
}

export async function verify(options: VerifyOptions): Promise<VerifyReport> {
  const cwd = options.cwd ?? process.cwd();
  const shas = await commitsInRange(cwd, options.base, options.head);

  const commits: PerCommitResult[] = [];
  for (const sha of shas) {
    commits.push(await classifyCommit(cwd, sha));
  }

  return { verdict: aggregate(commits), commits };
}

async function classifyCommit(cwd: string, sha: string): Promise<PerCommitResult> {
  const subject = await commitSubject(cwd, sha);
  const base = { sha, subject, perOpFindings: [], uncoveredFiles: [] };

  const ps = await parents(cwd, sha);
  if (ps.length !== 1 || !ps[0]) {
    return {
      ...base,
      class: 'skipped',
      reasons: [ps.length >= 2 ? 'merge-commit' : 'root-commit'],
    };
  }

  const block = extractWaiverBlock(await commitMessage(cwd, sha));
  if (block.kind === 'none') return { ...base, class: 'unwaivered', reasons: [] };
  if (block.kind === 'invalid') return { ...base, class: 'invalid', reasons: [block.reason] };

  const report = await stampWaiver(block.waiver, { base: ps[0], head: sha, cwd });
  return {
    ...base,
    class: report.stamped ? 'stamped' : 'invalid',
    reasons: report.failures,
    perOpFindings: report.ops,
    uncoveredFiles: report.uncovered,
  };
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
