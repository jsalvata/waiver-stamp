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

import { type Project, type SourceFile, SyntaxKind } from 'ts-morph';
import type { Op } from '../types.js';

export interface GuardFinding {
  guard: string;
  detail: string;
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
 * Guards that depend only on the targeted symbols (run over the base program).
 *
 * `excluded` is the set of files already confined by a `change-test`/`change-docs`
 * op (the caller computes this — see `stampWaiver`). Those files are skipped by
 * the dynamic-reference scan: they're already removed from the comparison (spec
 * §6.2), so a string literal mentioning the renamed symbol there (e.g. a test
 * `describe(...)` title) can't smuggle an unaccounted production change.
 */
export function runReproductiveGuards(
  project: Project,
  ops: readonly Op[],
  excluded: ReadonlySet<string>,
): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const op of ops) {
    if (op.op !== 'rename') continue;
    if (PUBLISHED_SURFACE.test(op.target.file)) {
      findings.push({
        guard: 'public-api',
        detail: `${op.target.file} is a published surface; cross-repo consumers are invisible`,
      });
    }
    findings.push(...dynamicReferenceScan(project, op.target.symbol, excluded));
  }
  return findings;
}

/** Whether `sf`'s path ends in one of the repo-relative `excluded` paths. */
function isConfined(sf: SourceFile, excluded: ReadonlySet<string>): boolean {
  const path = sf.getFilePath();
  for (const file of excluded) {
    if (path === file || path.endsWith(`/${file}`)) return true;
  }
  return false;
}

/**
 * Heuristic scan for references the language service can't track: a string
 * literal containing the symbol name (string-keyed DI/registry, `obj["name"]`).
 * Conservative and FAIL-closed — a false positive only sends the PR to review.
 */
function dynamicReferenceScan(
  project: Project,
  symbol: string,
  excluded: ReadonlySet<string>,
): GuardFinding[] {
  const name = symbolLeaf(symbol);
  const word = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  for (const sf of project.getSourceFiles()) {
    if (isConfined(sf, excluded)) continue;
    const literals = [
      ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ];
    for (const lit of literals) {
      if (word.test(lit.getLiteralText())) {
        return [
          {
            guard: 'dynamic-reference',
            detail: `'${name}' appears in a string literal in ${sf.getBaseName()}; the rename cannot reach it`,
          },
        ];
      }
    }
  }
  return [];
}

/**
 * The tsc-vs-deploy emit gap (spec §8): a changed file touching a construct
 * transpilers erase differently — `const enum`, `namespace`, `import =`,
 * parameter properties, or decorators under `emitDecoratorMetadata` — FAILs.
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
    if (hasParameterProperty(sf)) {
      findings.push({ guard: 'emit-divergence', detail: `parameter property in ${name}` });
    }
  }
  return findings;
}

/** A constructor parameter with an accessibility/readonly modifier emits a field. */
function hasParameterProperty(sf: SourceFile): boolean {
  return sf
    .getDescendantsOfKind(SyntaxKind.Parameter)
    .some(
      (p) => p.getModifiers().length > 0 && p.getParentIfKind(SyntaxKind.Constructor) !== undefined,
    );
}
