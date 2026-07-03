/**
 * `move-file` (spec §6.1) — native ts-morph `SourceFile#move`, which relocates
 * the file within the loaded program and rewrites the module specifiers of
 * relative imports/exports pointing at it (and its own). Refuses on collision.
 */

import { isAbsolute, join } from 'node:path';
import type { Project } from 'ts-morph';
import { OpApplicationError } from '../../errors.js';
import type { MoveFileOp } from '../../types.js';
import { getSourceFile } from '../project.js';

export function applyMoveFile(project: Project, cwd: string, op: MoveFileOp): void {
  const sf = getSourceFile(project, cwd, op.from);

  const toAbs = isAbsolute(op.to) ? op.to : join(cwd, op.to);
  if (project.getSourceFile(toAbs)) {
    throw new OpApplicationError('move-file', `a source file already exists at '${op.to}'`);
  }

  sf.move(toAbs);
}
