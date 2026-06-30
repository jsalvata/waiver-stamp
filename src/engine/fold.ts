/**
 * Fold a waiver's transform ops over a loaded project, in order (spec §2, §3.1).
 * Exclusion ops never touch the tree, so they are skipped here. The single
 * dispatch point new reproductive ops register against.
 */

import type { Project } from 'ts-morph';
import { OpApplicationError } from '../errors.js';
import type { Op } from '../types.js';
import { applyRename } from './ops/rename.js';

export function foldOps(project: Project, cwd: string, ops: readonly Op[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'rename':
        applyRename(project, cwd, op);
        break;
      case 'change-test':
      case 'change-docs':
        break; // exclusion ops are comparison directives, not tree mutations (§2)
      case 'extract-function':
      case 'move-to-new-file':
      case 'bump':
        throw new OpApplicationError(op.op, 'not yet implemented in v0');
    }
  }
}
