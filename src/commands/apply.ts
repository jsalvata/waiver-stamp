import { relative } from 'node:path';
import { foldOps } from '../engine/fold.ts';
import { loadProject } from '../engine/project.ts';
import { loadWaiver } from '../waiver/load.ts';
import type { Waiver } from '../waiver/types.ts';

export interface ApplyOptions {
  /** Working tree to apply the waiver's transform ops to. */
  cwd: string;
  /**
   * Where a `lint-fix` op resolves its linter binary from (spec §9). Defaults to
   * `cwd`; override when the install is hoisted elsewhere (e.g. a monorepo
   * workspace root).
   */
  toolchainRoot?: string;
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

  const linted = foldOps(project, options.cwd, waiver.ops, options.toolchainRoot ?? options.cwd);

  // Files still unsaved are the in-memory AST ops' output; `lint-fix` reports its
  // own changes separately (it flushes and reloads them, so they read as saved).
  const unsaved = project
    .getSourceFiles()
    .filter((sf) => !sf.isSaved())
    .map((sf) => relative(options.cwd, sf.getFilePath()));

  await project.save();
  return { files: [...new Set([...unsaved, ...linted])] };
}
