import { relative } from 'node:path';
import { foldOps } from './engine/fold.ts';
import { loadProject } from './engine/project.ts';
import { loadWaiver } from './load.ts';
import type { Waiver } from './types.ts';

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
  return applyWaiver(await loadWaiver(path), options);
}

/** Apply an already-loaded waiver (the seam the MCP `waiver_apply` tool reuses, §18.1). */
export async function applyWaiver(waiver: Waiver, options: ApplyOptions): Promise<ApplyResult> {
  const project = loadProject(options.cwd);

  foldOps(project, options.cwd, waiver.ops);

  const changed = project
    .getSourceFiles()
    .filter((sf) => !sf.isSaved())
    .map((sf) => relative(options.cwd, sf.getFilePath()));

  await project.save();
  return { files: changed };
}
