/**
 * `move-file` (spec §6.1) — relocate a source file and rewrite the module
 * specifiers of relative imports/exports that reference it (and its own).
 *
 * We drive this through the TypeScript language service's `getEditsForFileRename`
 * — the same engine an IDE's "move file" refactor uses — rather than ts-morph's
 * `SourceFile#move`. `move` computes specifiers via `getRelativePathAsModuleSpecifierTo`,
 * which strips the extension unconditionally and never re-appends `.js`, producing
 * imports that break under Node16/NodeNext resolution. The language service derives
 * each specifier's ending from module resolution, so `.js` endings survive.
 * Refuses on collision.
 */

import { isAbsolute, join } from 'node:path';
import type { Project } from 'ts-morph';
import { OpApplicationError } from '../../errors.ts';
import type { MoveFileOp } from '../../waiver/types.ts';
import { getSourceFile } from '../project.ts';

export function applyMoveFile(project: Project, cwd: string, op: MoveFileOp): void {
  const sf = getSourceFile(project, cwd, op.from);
  const fromAbs = sf.getFilePath();

  const toAbs = isAbsolute(op.to) ? op.to : join(cwd, op.to);
  if (project.getSourceFile(toAbs)) {
    throw new OpApplicationError('move-file', `a source file already exists at '${op.to}'`);
  }

  // Compute every specifier edit the rename implies (referencing files and the
  // moved file's own imports), then apply each in place.
  const edits = project
    .getLanguageService()
    .compilerObject.getEditsForFileRename(fromAbs, toAbs, {}, {});
  for (const edit of edits) {
    const target = project.getSourceFile(edit.fileName);
    if (!target) {
      throw new OpApplicationError(
        'move-file',
        `rename edit targets a file outside the loaded program: '${edit.fileName}'`,
      );
    }
    target.applyTextChanges(edit.textChanges);
  }

  // The edits rebased the moved file's own specifiers in place; relocate it by
  // recreating the (now-edited) text at the destination and dropping the source.
  const movedText = sf.getFullText();
  sf.delete();
  project.createSourceFile(toAbs, movedText);
}
