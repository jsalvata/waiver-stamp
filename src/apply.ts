import { relative } from 'node:path';
import { foldOps } from './engine/fold.js';
import { loadProject } from './engine/project.js';
import { loadWaiver } from './load.js';

export interface ApplyOptions {
  /** Working tree to apply the waiver's transform ops to. */
  cwd: string;
}

export interface ApplyResult {
  /** Paths (relative to `cwd`) the fold created or modified. */
  files: string[];
}

/**
 * Runner (§4): apply a waiver's transform ops to the working tree at `cwd`,
 * deterministically. Exclusion ops describe hand-edits the author already made;
 * `apply` does not generate those. Loads the repo's own tsconfig program, folds
 * the transform ops in order (§2), and saves the result.
 */
export async function apply(path: string, options: ApplyOptions): Promise<ApplyResult> {
  const waiver = await loadWaiver(path);
  const project = loadProject(options.cwd);

  foldOps(project, options.cwd, waiver.ops);

  const changed = project
    .getSourceFiles()
    .filter((sf) => !sf.isSaved())
    .map((sf) => relative(options.cwd, sf.getFilePath()));

  await project.save();
  return { files: changed };
}
