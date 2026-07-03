import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { emitForFile } from './engine/emit-compare.js';
import { predicateOk } from './engine/exclude.js';
import { applyTransformOp } from './engine/fold.js';
import { baseChecks, emitDivergenceGuard, headChecks } from './engine/guards.js';
import { loadProject } from './engine/project.js';
import { changedFiles, worktreeAt } from './git.js';
import type { FileFinding, OpFinding, StampReport } from './report.js';
import type { Op, Waiver } from './types.js';

export interface StampOptions {
  /** Base git ref to fold the transform ops over. */
  base: string;
  /** Head git ref whose diff is being stamped. */
  head: string;
  /** Repo path where `base`/`head` live. Defaults to `process.cwd()`. */
  cwd?: string;
}

type Project = ReturnType<typeof loadProject>;

const TS_SOURCE = /\.(ts|tsx|mts|cts)$/;
const DECLARATION = /\.d\.ts$/;

/**
 * Stamper (§4): validate a PR diff against its waiver via the §3.1 stamping
 * principle — fold the transform ops over a clean `base` checkout to produce `O`,
 * predicate-check the exclusion ops, then require that every changed file not
 * excluded has matching compiler emit between `O` and head (spec §7).
 *
 * Does NOT run tsc or tests — the §3.1.6 backstop is the host CI's job (spec §4).
 */
export async function stampWaiver(waiver: Waiver, options: StampOptions): Promise<StampReport> {
  const cwd = options.cwd ?? process.cwd();

  const oWt = await worktreeAt(cwd, options.base);
  const headWt = await worktreeAt(cwd, options.head);
  try {
    const opFindings: OpFinding[] = [];
    const fileFindings: FileFinding[] = [];
    const failures: string[] = [];
    const excluded = new Set<string>();

    const oProject = loadProject(oWt.dir);
    const headProject = loadProject(headWt.dir);

    // Exclusion ops first: the guards and the transform pass both need the
    // confined file set they produce (spec §6.2).
    for (const op of waiver.ops) {
      if (op.op === 'change-test' || op.op === 'change-docs') {
        applyExclusionOp(op, excluded, fileFindings, failures, opFindings);
      }
    }

    // Guards over the base program, before the transform folds the rename in:
    // public-API + the new-name capture scan (§8).
    for (const finding of baseChecks({ project: oProject, root: oWt.dir }, waiver.ops, excluded)) {
      failures.push(`guard ${finding.guard}: ${finding.detail}`);
    }

    for (const op of waiver.ops) {
      if (op.op !== 'change-test' && op.op !== 'change-docs') {
        applyTransform(oProject, oWt.dir, op, opFindings, failures);
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

    const compareSet = await buildCompareSet(cwd, options, oProject, oWt.dir, excluded);

    // Emit-divergence guard over the changed files on head (the tsc-vs-deploy gap, §8).
    for (const finding of emitDivergenceGuard(
      headProject,
      compareSet.map((f) => join(headWt.dir, f)),
    )) {
      failures.push(`guard ${finding.guard}: ${finding.detail}`);
    }

    for (const file of compareSet) {
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
): void {
  let ok = true;
  for (const file of op.files) {
    if (predicateOk(op.op, file)) {
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
  opFindings: OpFinding[],
  failures: string[],
): void {
  try {
    applyTransformOp(oProject, dir, op);
    opFindings.push({ op: op.op, ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    opFindings.push({ op: op.op, ok: false, reason });
    failures.push(`${op.op} failed: ${reason}`);
  }
}

async function buildCompareSet(
  cwd: string,
  options: StampOptions,
  oProject: Project,
  oDir: string,
  excluded: Set<string>,
): Promise<string[]> {
  const changed = await changedFiles(cwd, options.base, options.head);
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
