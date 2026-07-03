/** The PASS/FAIL report shape `waiver stamp --json` emits (§10) — the seam for the automation layer. */

import type { OpKind } from './types.js';

export interface ValidationReport {
  /** True iff the PR is fully accounted for by the waiver and every guard holds. */
  stamped: boolean;
  waiver: { schema: string };
  /** Per-op outcome, in waiver order. */
  ops: OpFinding[];
  /** Per-file outcome over the compared set. */
  files: FileFinding[];
  /** Files changed base→head that are neither reproduced by `O` nor excluded. */
  uncovered: string[];
  /** Human-readable reasons the stamp failed (empty when stamped). */
  failures: string[];
}

export interface OpFinding {
  op: OpKind;
  ok: boolean;
  reason?: string;
}

export type FileStatus = 'reproduced' | 'excluded' | 'unchanged' | 'mismatch';

export interface FileFinding {
  file: string;
  status: FileStatus;
  reason?: string;
}

// ── Per-commit verification (§17.2) ──────────────────────────────────────────

/** How a single commit in a verified range was classified (§17.2). */
export type CommitClass = 'stamped' | 'invalid' | 'unwaivered' | 'skipped';

/** The aggregate verdict over a commit range (§17.2). */
export type Verdict = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' | 'ABSTAIN';

export interface PerCommitResult {
  sha: string;
  subject: string;
  class: CommitClass;
  /** Why this class (e.g. 'merge-commit', emit-mismatch reasons). */
  reasons: string[];
  /** Per-op stamping outcome when the commit carried a waiver. */
  perOpFindings: OpFinding[];
  /** Changed files neither reproduced nor excluded (when stamping failed). */
  uncoveredFiles: string[];
}

export interface VerifyReport {
  /** The highest-severity verdict present (REQUEST_CHANGES > COMMENT > APPROVE > ABSTAIN). */
  verdict: Verdict;
  commits: PerCommitResult[];
}

/** Process exit codes (§10). */
export const EXIT = {
  /** Stamped. */
  STAMPED: 0,
  /** Stamping / guard / coverage failure. */
  FAILURE: 1,
  /** Malformed waiver. */
  MALFORMED: 2,
  /** Internal error (includes not-yet-implemented in the v0 scaffold). */
  INTERNAL: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
