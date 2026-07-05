import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { coverDependencyBump } from '../engine/deps.ts';
import { emitForFile } from '../engine/emit-compare.ts';
import { type DocPolicy, loadDocPolicy, predicateOk } from '../engine/exclude.ts';
import { applyTransformOp } from '../engine/fold.ts';
import { baseChecks, emitDivergenceGuard, headChecks } from '../engine/guards.ts';
import { loadProject } from '../engine/project.ts';
import { CommitParentError } from '../errors.ts';
import { changedFiles, parents, worktreeAt } from '../git.ts';
import type { Op, Waiver } from '../waiver/types.ts';
import type { FileFinding, OpFinding, ValidationReport } from './report.ts';

export interface ValidateOptions {
  /** The commit whose diff against its parent is validated. */
  commit: string;
  /** Repo path where `commit` lives. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Where a `lint-fix` op resolves its linter binary from — an installed
   * `node_modules` (spec §9). Defaults to `cwd`; override when the install is
   * hoisted elsewhere (e.g. a monorepo workspace root), since the checked-out
   * worktrees the fold runs over never carry an install.
   */
  toolchainRoot?: string;
}

type Project = ReturnType<typeof loadProject>;

const TS_SOURCE = /\.(ts|tsx|mts|cts)$/;
const DECLARATION = /\.d\.ts$/;

/**
 * Validate one commit against its waiver via the §3.1 stamping principle — fold
 * the transform ops over a clean checkout of the commit's parent to produce `O`,
 * predicate-check the exclusion ops, then require that every changed file not
 * excluded has matching compiler emit between `O` and the commit (spec §7). The
 * parent is derived here, so callers pass only the commit.
 *
 * Does NOT run tsc or tests — the §3.1.6 backstop is the host CI's job (spec §4).
 */
export async function validateCommit(
  waiver: Waiver,
  options: ValidateOptions,
): Promise<ValidationReport> {
  const cwd = options.cwd ?? process.cwd();
  const toolchainRoot = options.toolchainRoot ?? cwd;
  const head = options.commit;
  const [base] = await parents(cwd, head);
  if (!base) throw new CommitParentError(head);

  const oWt = await worktreeAt(cwd, base);
  const headWt = await worktreeAt(cwd, head);
  try {
    const opFindings: OpFinding[] = [];
    const fileFindings: FileFinding[] = [];
    const failures: string[] = [];
    const excluded = new Set<string>();

    const oProject = loadProject(oWt.dir);
    const headProject = loadProject(headWt.dir);

    // The `change-docs` allow/deny policy, read from BASE (spec §6.2) — a PR
    // cannot widen it for itself, matching the `allowBumping` policy (§6.3). A
    // malformed config fails closed: confine nothing, record the failure.
    let docPolicy: DocPolicy;
    try {
      docPolicy = await loadDocPolicy(oWt.dir);
    } catch (err) {
      docPolicy = { permits: () => false };
      failures.push(`invalid config: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Exclusion ops first: the guards and the transform pass both need the
    // confined file set they produce (spec §6.2).
    for (const op of waiver.ops) {
      if (op.op === 'change-test' || op.op === 'change-docs') {
        applyExclusionOp(op, excluded, fileFindings, failures, opFindings, docPolicy);
      }
    }

    // Guards over the base program, before the transform folds the rename in:
    // public-API + the new-name capture scan (§8).
    for (const finding of baseChecks({ project: oProject, root: oWt.dir }, waiver.ops, excluded)) {
      failures.push(`guard ${finding.guard}: ${finding.detail}`);
    }

    for (const op of waiver.ops) {
      if (op.op !== 'change-test' && op.op !== 'change-docs') {
        // The base worktree has no install; resolve the linter from `toolchainRoot`.
        applyTransform(oProject, oWt.dir, op, toolchainRoot, opFindings, failures);
      }
    }

    // Guards over head, after the rename has landed: the old-name stale scan (§8).
    for (const finding of headChecks(
      { project: headProject, root: headWt.dir },
      waiver.ops,
      excluded,
    )) {
      failures.push(`guard ${finding.guard}: ${finding.detail}`);
    }

    const compareSet = await buildCompareSet(cwd, base, head, oProject, oWt.dir, excluded);

    // Emit-divergence guard over the changed files on head (the tsc-vs-deploy gap, §8).
    for (const finding of emitDivergenceGuard(
      headProject,
      compareSet.map((f) => join(headWt.dir, f)),
    )) {
      failures.push(`guard ${finding.guard}: ${finding.detail}`);
    }

    // Standing dependency-bump policy (§6.3): may cover package.json + lockfile.
    const claimed = await coverDependencyBump(
      compareSet,
      { oDir: oWt.dir, headDir: headWt.dir },
      fileFindings,
      failures,
    );

    for (const file of compareSet) {
      if (claimed.has(file)) continue;
      const equal = await filesEquivalent(file, oProject, oWt.dir, headProject, headWt.dir);
      fileFindings.push({ file, status: equal ? 'reproduced' : 'mismatch' });
      if (!equal) failures.push(`uncovered change: ${file}`);
    }

    const uncovered = fileFindings.filter((f) => f.status === 'mismatch').map((f) => f.file);
    return {
      stamped: failures.length === 0,
      waiver: { schema: waiver.schema },
      ops: opFindings,
      files: fileFindings,
      uncovered,
      failures,
    };
  } finally {
    await oWt.cleanup();
    await headWt.cleanup();
  }
}

function applyExclusionOp(
  op: Extract<Op, { op: 'change-test' | 'change-docs' }>,
  excluded: Set<string>,
  fileFindings: FileFinding[],
  failures: string[],
  opFindings: OpFinding[],
  docPolicy: DocPolicy,
): void {
  let ok = true;
  for (const file of op.files) {
    if (predicateOk(op.op, file, docPolicy)) {
      excluded.add(file);
      fileFindings.push({ file, status: 'excluded' });
    } else {
      ok = false;
      fileFindings.push({ file, status: 'mismatch', reason: 'failed confinement predicate' });
      const what = op.op === 'change-test' ? 'test' : 'doc';
      failures.push(`${op.op}: ${file} is not a confined ${what} file`);
    }
  }
  opFindings.push({ op: op.op, ok });
}

function applyTransform(
  oProject: Project,
  dir: string,
  op: Op,
  toolchainRoot: string,
  opFindings: OpFinding[],
  failures: string[],
): void {
  try {
    applyTransformOp(oProject, dir, op, toolchainRoot);
    opFindings.push({ op: op.op, ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    opFindings.push({ op: op.op, ok: false, reason });
    failures.push(`${op.op} failed: ${reason}`);
  }
}

async function buildCompareSet(
  cwd: string,
  base: string,
  head: string,
  oProject: Project,
  oDir: string,
  excluded: Set<string>,
): Promise<string[]> {
  const changed = await changedFiles(cwd, base, head);
  const touched = oProject
    .getSourceFiles()
    .filter((sf) => !sf.isSaved())
    .map((sf) => relative(oDir, sf.getFilePath()));
  return [...new Set([...changed, ...touched])].filter((f) => !excluded.has(f));
}

async function filesEquivalent(
  file: string,
  oProject: Project,
  oDir: string,
  headProject: Project,
  headDir: string,
): Promise<boolean> {
  if (TS_SOURCE.test(file) && !DECLARATION.test(file)) {
    return (
      emitForFile(oProject, join(oDir, file)) === emitForFile(headProject, join(headDir, file))
    );
  }
  // Non-TS (and .d.ts) files have no runtime emit; compare raw bytes so an
  // un-accounted change to a JSON/SQL/asset still FAILs (spec §7 reference assets).
  const [a, b] = await Promise.all([
    readOrEmpty(join(oDir, file)),
    readOrEmpty(join(headDir, file)),
  ]);
  return a.equals(b);
}

async function readOrEmpty(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    return Buffer.alloc(0);
  }
}
