/**
 * Static guards (spec §8). They close gaps the loaded program can't see for
 * reproductive ops, and the tsc-vs-deploy emit gap. Every hit is FAIL-closed —
 * the stamp fails and the PR falls to human review.
 *
 * v0 implements the soundness-critical subset: the dynamic-reference scan (the
 * "modulo introspection" caveat), the published-surface guard, and the
 * emit-divergence guard (the enumerated tsc-vs-transpiler set). The single-project
 * guard is implicit — only one tsconfig program is loaded — and documented as a
 * v0 limitation in the README.
 */

import { dirname, isAbsolute, join, relative } from 'node:path';
import { Node, type Project, SyntaxKind } from 'ts-morph';
import type { Op } from '../waiver/types.ts';

export interface GuardFinding {
  guard: string;
  detail: string;
}

/** A loaded program paired with the checkout root its excluded paths are relative to. */
export interface Checkout {
  project: Project;
  root: string;
}

const PUBLISHED_SURFACE = /(^|\/)libs\/[^/]*-(sdk|api-contract)\/.*index\.ts$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function symbolLeaf(symbol: string): string {
  const dot = symbol.lastIndexOf('.');
  return dot === -1 ? symbol : symbol.slice(dot + 1);
}

/**
 * Reproductive checks over `base`, run BEFORE the transform folds the op in:
 *
 * - **public-API guard** — a symbol exported from (or a file on) a published
 *   surface has cross-repo consumers the program can't see.
 * - **capture scan** — the *new* name (or, for `move-file`, the *destination*
 *   path) already appears in a string literal in base, so the freshly-introduced
 *   symbol/file would silently absorb a pre-existing dynamic reference.
 *
 * `excluded` is the set of files confined by a `change-test`/`change-docs` op
 * (the caller computes it — see `validateCommit`); they're skipped, already out of
 * the comparison (spec §6.2). `base.root` resolves those relative paths.
 */
export function baseChecks(
  base: Checkout,
  ops: readonly Op[],
  excluded: ReadonlySet<string>,
): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const op of ops) {
    if (op.op === 'rename') {
      if (PUBLISHED_SURFACE.test(op.target.file)) {
        findings.push({
          guard: 'public-api',
          detail: `${op.target.file} is a published surface; cross-repo consumers are invisible`,
        });
      }
      findings.push(...dynamicReferenceScan(base, symbolLeaf(op.to), excluded, 'captured'));
    } else if (op.op === 'move-file') {
      if (PUBLISHED_SURFACE.test(op.from)) {
        findings.push({
          guard: 'public-api',
          detail: `${op.from} is a published surface; cross-repo consumers are invisible`,
        });
      }
      findings.push(...dynamicPathReferenceScan(base, op.to, excluded, 'captured'));
    }
  }
  return findings;
}

/**
 * Reproductive check over `head`, run AFTER the transform has landed: the
 * **stale scan** — the *old* name (or, for `move-file`, the *old* path) still
 * appears in a string literal in head, so it can no longer resolve to the
 * renamed symbol / moved file. Reads head, not the folded base, so a commit
 * that also edits the string away — e.g. a descriptive test title the human
 * updated — clears the guard. Excluded files are skipped as in `baseChecks`;
 * `head.root` resolves the relative paths.
 */
export function headChecks(
  head: Checkout,
  ops: readonly Op[],
  excluded: ReadonlySet<string>,
): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const op of ops) {
    if (op.op === 'rename') {
      findings.push(...dynamicReferenceScan(head, symbolLeaf(op.target.symbol), excluded, 'stale'));
    } else if (op.op === 'move-file') {
      findings.push(...dynamicPathReferenceScan(head, op.from, excluded, 'stale'));
    }
  }
  return findings;
}

/** Which side of the transform a dynamic-reference hit sits on, for the finding detail. */
type Direction = 'stale' | 'captured';

/**
 * Heuristic scan for references the language service can't track: a string
 * literal containing the symbol name (string-keyed DI/registry, `obj["name"]`).
 * Conservative and FAIL-closed — a false positive only sends the PR to review.
 */
function dynamicReferenceScan(
  checkout: Checkout,
  name: string,
  excluded: ReadonlySet<string>,
  direction: Direction,
): GuardFinding[] {
  const word = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  for (const sf of checkout.project.getSourceFiles()) {
    if (excluded.has(relative(checkout.root, sf.getFilePath()))) continue;
    const literals = [
      ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ];
    for (const lit of literals) {
      if (word.test(lit.getLiteralText())) {
        return [
          { guard: 'dynamic-reference', detail: detailFor(direction, name, sf.getBaseName()) },
        ];
      }
    }
  }
  return [];
}

function detailFor(direction: Direction, name: string, file: string): string {
  return direction === 'stale'
    ? `old name '${name}' still appears in a string literal in ${file} after the rename; it can no longer resolve to the renamed symbol`
    : `new name '${name}' already appears in a string literal in ${file} before the rename; the renamed symbol may silently capture it`;
}

/**
 * The `move-file` analogue of {@link dynamicReferenceScan}: a string literal
 * that resolves to `path` but is not a static import/export specifier or a
 * dynamic `import()` argument (both of which ts-morph's `move` rewrites) —
 * e.g. `require('./x')`, `jest.mock('./x')`, or a path in config data.
 * Direction mirrors the rename scans: 'captured' checks the destination path
 * over base, 'stale' checks the old path over head. Conservative, FAIL-closed.
 */
function dynamicPathReferenceScan(
  checkout: Checkout,
  path: string,
  excluded: ReadonlySet<string>,
  direction: Direction,
): GuardFinding[] {
  const targetAbs = isAbsolute(path) ? path : join(checkout.root, path);
  const targetNoExt = stripTsExtension(targetAbs);
  for (const sf of checkout.project.getSourceFiles()) {
    if (excluded.has(relative(checkout.root, sf.getFilePath()))) continue;
    const literals = [
      ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ];
    for (const lit of literals) {
      if (isRewrittenSpecifier(lit)) continue;
      const text = lit.getLiteralText();
      const candidates = [text, stripTsExtension(text)].flatMap((t) =>
        t.startsWith('./') || t.startsWith('../')
          ? [join(dirname(sf.getFilePath()), t)]
          : [join(checkout.root, t)],
      );
      if (candidates.some((c) => c === targetAbs || c === targetNoExt)) {
        return [
          { guard: 'dynamic-reference', detail: pathDetailFor(direction, text, sf.getBaseName()) },
        ];
      }
    }
  }
  return [];
}

function pathDetailFor(direction: Direction, text: string, file: string): string {
  return direction === 'stale'
    ? `'${text}' in ${file} still references the old path outside an import after the move; it can no longer resolve to the moved file`
    : `'${text}' in ${file} already references the destination path outside an import before the move; the moved file may silently capture it`;
}

function stripTsExtension(path: string): string {
  return path.replace(/\.(ts|tsx|mts|cts)$/, '');
}

/** A module specifier ts-morph's `move` rewrites: static import/export, or dynamic `import()`. */
function isRewrittenSpecifier(lit: Node): boolean {
  const parent = lit.getParent();
  if (!parent) return false;
  if (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent)) return true;
  return (
    Node.isCallExpression(parent) &&
    parent.getExpression().getKind() === SyntaxKind.ImportKeyword &&
    parent.getArguments()[0] === lit
  );
}

/**
 * The tsc-vs-deploy emit gap (spec §8): a changed file touching a construct
 * transpilers erase differently — `const enum`, `namespace`, `import =`,
 * or decorators under `emitDecoratorMetadata` — FAILs.
 *
 * Parameter properties are deliberately NOT flagged: they are synthesis rather
 * than erasure, but every mainstream transpiler compiles them the same way tsc
 * does (assignment after `super()`, set semantics), and flagging them rejects
 * any file with error-class-style constructors. Accepted shortcoming (§8);
 * the sound fix is comparing emit under the deploy transpiler.
 */
export function emitDivergenceGuard(project: Project, absFiles: readonly string[]): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const decoratorMetadata = project.getCompilerOptions().emitDecoratorMetadata === true;

  for (const abs of absFiles) {
    const sf = project.getSourceFile(abs);
    if (!sf) continue;
    const name = sf.getBaseName();

    if (
      sf.getDescendantsOfKind(SyntaxKind.ModuleDeclaration).some((m) => m.hasNamespaceKeyword())
    ) {
      findings.push({ guard: 'emit-divergence', detail: `namespace in ${name}` });
    }
    if (sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration).length > 0) {
      findings.push({ guard: 'emit-divergence', detail: `import = in ${name}` });
    }
    if (sf.getEnums().some((e) => e.isConstEnum())) {
      findings.push({ guard: 'emit-divergence', detail: `const enum in ${name}` });
    }
    if (decoratorMetadata && sf.getDescendantsOfKind(SyntaxKind.Decorator).length > 0) {
      findings.push({ guard: 'emit-divergence', detail: `decorator metadata in ${name}` });
    }
  }
  return findings;
}
