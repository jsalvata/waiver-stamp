/**
 * `lint-fix` (spec §5.1, §6.1) — run the repo's own committed linter over the
 * named files, applying safe fixes only. Tool-reproducible, not engine-performed:
 * the transform is delegated to an external binary (v0: Biome or ESLint) resolved from the
 * invoking checkout's install. Reproduction is the whole claim — `O`'s post-fix
 * emit must equal head's, so a hand edit smuggled alongside the lint fix still
 * mismatches (§6.1). Not strictly behaviour-preserving (import reordering changes
 * module evaluation order); accepted by policy, not guarded (§6.1).
 *
 * Unlike the pure AST ops, this one touches disk: prior in-memory ops must be
 * flushed so the linter sees the post-fold content, then the fixed files reloaded
 * so the emit comparison (and `apply`'s save) see the linter's output — otherwise
 * `apply`'s trailing `project.save()` would clobber the fixes with stale text.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { FileSystemRefreshResult, type Project, type SourceFile } from 'ts-morph';
import { OpApplicationError } from '../../errors.ts';
import type { LintFixOp } from '../../waiver/types.ts';

/**
 * Run the repo's linter over `op.files`, returning the files (relative to `cwd`)
 * whose content the fold actually changed — either an earlier op edited them or
 * the linter did.
 *
 * `cwd` is the tree being folded (its committed linter config applies); it holds
 * the files. `toolchainRoot` is where the linter binary lives (the invoking repo,
 * which has an install) — the same tree in `apply`, the real repo in verification.
 */
export function applyLintFix(
  project: Project,
  cwd: string,
  op: LintFixOp,
  toolchainRoot: string,
): string[] {
  const linter = resolveLinter(cwd, toolchainRoot);
  const changed = new Set<string>();

  // Flush prior in-memory ops (a move-file's rewritten import specifiers, say) so
  // the linter fixes the post-fold code on disk.
  const targets: { rel: string; sf: SourceFile }[] = [];
  for (const rel of op.files) {
    const abs = isAbsolute(rel) ? rel : join(cwd, rel);
    const sf = project.getSourceFile(abs);
    if (!sf) continue; // not a program file — the linter still fixes it on disk
    if (!sf.isSaved()) {
      changed.add(rel); // an earlier op already edited this file
      sf.saveSync();
    }
    targets.push({ rel, sf });
  }

  runLinter(linter, cwd, op.files);

  // Reload the fixed files into the program so the emit comparison sees them;
  // the refresh reports whether the linter actually changed each file, so no
  // snapshot of the pre-lint text needs to be held.
  for (const { rel, sf } of targets) {
    if (sf.refreshFromFileSystemSync() === FileSystemRefreshResult.Updated) changed.add(rel);
  }

  return [...changed];
}

/** A resolved linter: the executable to run and the CLI verb that applies safe fixes. */
interface Linter {
  bin: string;
  args: readonly string[];
}

/**
 * A linter `lint-fix` knows how to drive: the manifest package that declares it, its
 * binary name, and the CLI verb that applies safe fixes in place. Biome's `check --write`
 * applies safe fixes and organizes imports; `--unsafe` is deliberately omitted so only
 * safe fixes land (§6.1).
 */
interface LinterSpec {
  pkg: string;
  bin: string;
  args: readonly string[];
}

/** The linters `lint-fix` supports, resolved from the folded tree's own manifest (§6.1). */
const SUPPORTED_LINTERS: readonly LinterSpec[] = [
  { pkg: '@biomejs/biome', bin: 'biome', args: ['check', '--write'] },
  { pkg: 'eslint', bin: 'eslint', args: ['--fix'] },
];

/**
 * Resolve the repo's linter (v0 catalog). The linter must be declared in the
 * folded tree's own manifest — the committed toolchain is the source of truth
 * (§6.1) — and its binary is resolved from an actual install (`toolchainRoot`
 * first, then the tree). Either miss FAILs closed (spec §9): an undeclared or
 * unresolvable linter never yields `O`, so it can never yield a false stamp.
 */
function resolveLinter(cwd: string, toolchainRoot: string): Linter {
  const declared = SUPPORTED_LINTERS.filter((linter) => manifestDeclares(cwd, linter.pkg));
  if (declared.length === 0) {
    throw new OpApplicationError(
      'lint-fix',
      `no supported linter is declared in the tree's package.json (supported: ${SUPPORTED_LINTERS.map((l) => l.pkg).join(', ')})`,
    );
  }
  if (declared.length > 1) {
    throw new OpApplicationError(
      'lint-fix',
      `the tree declares multiple supported linters (${declared
        .map((l) => l.pkg)
        .join(', ')}); the committed toolchain is ambiguous`,
    );
  }
  const [spec] = declared as [LinterSpec, ...LinterSpec[]];
  const bin = resolveBin(spec.bin, [toolchainRoot, cwd]);
  if (!bin) {
    throw new OpApplicationError(
      'lint-fix',
      `${spec.pkg} is declared but its ${spec.bin} binary was not found in node_modules/.bin (run the package install)`,
    );
  }
  return { bin, args: spec.args };
}

/** Whether `pkg` appears in the tree's package.json dependencies or devDependencies. */
function manifestDeclares(cwd: string, pkg: string): boolean {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  } catch {
    return false;
  }
  return pkg in { ...manifest.dependencies, ...manifest.devDependencies };
}

/** The first `node_modules/.bin/<name>` that exists under one of `roots`, or undefined. */
function resolveBin(name: string, roots: readonly string[]): string | undefined {
  for (const root of roots) {
    const bin = join(root, 'node_modules', '.bin', name);
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

/**
 * Invoke the linter over the named files, with `cwd` as the working directory so
 * the tree's committed config applies. A non-zero exit from remaining diagnostics
 * is expected and ignored — the safe fixes still landed; only a failure to run the
 * binary at all (ENOENT, killed) FAILs closed.
 */
function runLinter(linter: Linter, cwd: string, files: readonly string[]): void {
  try {
    execFileSync(linter.bin, [...linter.args, ...files], { cwd, stdio: 'ignore' });
  } catch (err) {
    // execFileSync throws on any non-zero exit; distinguish "ran, found lint" (a
    // numeric status) from "could not run" (a spawn error with no status).
    if (typeof (err as { status?: number }).status === 'number') return;
    const detail = err instanceof Error ? err.message : String(err);
    throw new OpApplicationError('lint-fix', `linter could not be run: ${detail}`);
  }
}
