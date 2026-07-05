/**
 * Fold a waiver's transform ops over a loaded project, in order (spec §2, §3.1).
 * Exclusion ops never touch the tree, so they are skipped here. The single
 * dispatch point new reproductive ops register against.
 */

import type { Project } from 'ts-morph';
import { OpApplicationError } from '../errors.ts';
import type { Op } from '../waiver/types.ts';
import { applyLintFix } from './ops/lint-fix.ts';
import { applyMoveFile } from './ops/move-file.ts';
import { applyRename } from './ops/rename.ts';

/**
 * Apply one transform op to the project, returning the paths (relative to `cwd`)
 * it changed on disk. Only ops that write to disk mid-fold report paths —
 * `lint-fix` runs an external binary and refreshes files back into the program,
 * so its changes are invisible to the "unsaved source file" heuristic the callers
 * otherwise use. Pure in-memory AST ops return `[]`; their changes stay unsaved
 * and are picked up by the caller. Exclusion ops are a no-op here (§2).
 *
 * `toolchainRoot` is where the linter binary is resolved from (the invoking repo,
 * which has `node_modules`); it differs from `cwd` (the tree being folded) when a
 * throwaway worktree without an install is folded during verification.
 */
export function applyTransformOp(
  project: Project,
  cwd: string,
  op: Op,
  toolchainRoot: string,
): readonly string[] {
  switch (op.op) {
    case 'rename':
      applyRename(project, cwd, op);
      return [];
    case 'move-file':
      applyMoveFile(project, cwd, op);
      return [];
    case 'lint-fix':
      return applyLintFix(project, cwd, op, toolchainRoot);
    case 'change-test':
    case 'change-docs':
      return []; // exclusion ops are comparison directives, not tree mutations (§2)
    case 'extract-function':
    case 'move-to-new-file':
      throw new OpApplicationError(op.op, 'not yet implemented in v0');
  }
}

/**
 * Fold the transform ops over the project, in order, returning the union of the
 * paths ops changed directly on disk (see {@link applyTransformOp}).
 */
export function foldOps(
  project: Project,
  cwd: string,
  ops: readonly Op[],
  toolchainRoot: string = cwd,
): string[] {
  const touched = new Set<string>();
  for (const op of ops) {
    for (const file of applyTransformOp(project, cwd, op, toolchainRoot)) touched.add(file);
  }
  return [...touched];
}
