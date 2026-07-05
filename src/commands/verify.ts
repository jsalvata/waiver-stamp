import { commitMessage, commitSubject, parents, resolveCommit } from '../git.ts';
/** Single-commit verification (§17.4): classify one commit by its embedded waiver. */
import { extractWaiverBlock } from '../waiver/commit-waiver.ts';
import type { PerCommitResult } from './report.ts';
import { validateCommit } from './validate-commit.ts';

export interface VerifyOptions {
  /** Commit-ish to verify. Defaults to HEAD. */
  commit?: string;
  /** Repo path. Defaults to process.cwd(). */
  cwd?: string;
}

export async function verify(options: VerifyOptions = {}): Promise<PerCommitResult> {
  const cwd = options.cwd ?? process.cwd();
  const sha = await resolveCommit(cwd, options.commit ?? 'HEAD');
  return classifyCommit(cwd, sha);
}

export async function classifyCommit(cwd: string, sha: string): Promise<PerCommitResult> {
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

  const report = await validateCommit(block.waiver, { commit: sha, cwd });
  return {
    ...base,
    class: report.stamped ? 'stamped' : 'invalid',
    reasons: report.failures,
    perOpFindings: report.ops,
    uncoveredFiles: report.uncovered,
  };
}
