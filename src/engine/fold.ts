/**
 * Fold a waiver's transform ops over a loaded project, in order (spec §2, §3.1).
 * Exclusion ops never touch the tree, so they are skipped here. The single
 * dispatch point new reproductive ops register against.
 */

import type { Project } from 'ts-morph';
import { OpApplicationError } from '../errors.js';
import type { Op } from '../types.js';
import { applyMoveFile } from './ops/move-file.js';
import { applyRename } from './ops/rename.js';

/** Apply one transform op to the project. Exclusion ops are a no-op here (§2). */
export function applyTransformOp(project: Project, cwd: string, op: Op): void {
  switch (op.op) {
    case 'rename':
      applyRename(project, cwd, op);
      return;
    case 'move-file':
      applyMoveFile(project, cwd, op);
      return;
    case 'change-test':
    case 'change-docs':
      return; // exclusion ops are comparison directives, not tree mutations (§2)
    case 'extract-function':
    case 'move-to-new-file':
    case 'bump':
      throw new OpApplicationError(op.op, 'not yet implemented in v0');
  }
}

export function foldOps(project: Project, cwd: string, ops: readonly Op[]): void {
  for (const op of ops) applyTransformOp(project, cwd, op);
}
