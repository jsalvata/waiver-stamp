/**
 * `rename` (spec §6.1) — native ts-morph `node.rename`, which renames the symbol
 * and every reference within the loaded program. Refuses on collision.
 */

import type { Node, Project } from 'ts-morph';
import { OpApplicationError } from '../../errors.ts';
import type { RenameOp } from '../../types.ts';
import { findDeclarations, resolveSelector } from '../project.ts';

interface Renameable {
  rename(newName: string): void;
}

function asRenameable(node: Node): Renameable {
  const candidate = node as Node & Partial<Renameable>;
  if (typeof candidate.rename !== 'function') {
    throw new OpApplicationError('rename', 'target is not a renameable declaration');
  }
  return candidate as Renameable;
}

/** The selector symbol of `op.to` in the target's own scope (for collision checks). */
function targetNameInScope(symbol: string, to: string): string {
  const dot = symbol.indexOf('.');
  return dot === -1 ? to : `${symbol.slice(0, dot)}.${to}`;
}

export function applyRename(project: Project, cwd: string, op: RenameOp): void {
  const node = resolveSelector(project, cwd, op.target);
  const renameable = asRenameable(node);

  const scopedName = targetNameInScope(op.target.symbol, op.to);
  if (findDeclarations(project, cwd, op.target.file, scopedName).length > 0) {
    throw new OpApplicationError(
      'rename',
      `a declaration named '${op.to}' already exists in scope`,
    );
  }

  renameable.rename(op.to);
}
