/** The PASS/FAIL report shape `waiver stamp --json` emits (§10) — the seam for the automation layer. */

import type { OpKind } from './types.js';

export interface StampReport {
  /** True iff the PR is fully accounted for by the waiver and every guard holds. */
  stamped: boolean;
  waiver: { schema: string; tool: string };
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

/** Process exit codes (§10). */
export const EXIT = {
  /** Stamped. */
  STAMPED: 0,
  /** Stamping / guard / coverage failure. */
  FAILURE: 1,
  /** Malformed waiver / header mismatch. */
  MALFORMED: 2,
  /** Internal error (includes not-yet-implemented in the v0 scaffold). */
  INTERNAL: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
