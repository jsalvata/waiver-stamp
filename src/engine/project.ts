/**
 * Load a ts-morph `Project` from a checkout and resolve selectors against it
 * (spec §5.2). The single place the engine turns a `{file, symbol}` selector
 * into a concrete AST declaration; every reproductive op starts here.
 */

import { isAbsolute, join } from 'node:path';
import { type Node, Project, type SourceFile } from 'ts-morph';
import { SelectorResolutionError } from '../errors.ts';
import type { Selector } from '../waiver/types.ts';

/**
 * Load the project at `cwd` from its `tsconfig.json` (the repo's own config).
 *
 * `noEmit` is forced off so the stamper can emit through this program (spec §7);
 * the repo's own tsconfig often sets `noEmit: true` for type-checking. The
 * runtime-affecting options (target, module, decorator/enum/class-field settings)
 * are left untouched so emit matches the repo's build semantics.
 *
 * `allowImportingTsExtensions` is forced on so a `move-file` rename preserves a
 * repo's `.ts` import style: the language service only *generates* `.ts` endings
 * when that flag is set, so without it a move silently downgrades `.ts` imports to
 * `.js`. It is safe to force unconditionally — for repos that write `.js` or
 * extensionless specifiers the service preserves that style, so the flag is a
 * no-op there. (We cannot gate on `rewriteRelativeImportExtensions` instead:
 * ts-morph's bundled TypeScript strips that newer option, so it reads back absent.)
 */
export function loadProject(cwd: string): Project {
  return new Project({
    tsConfigFilePath: join(cwd, 'tsconfig.json'),
    compilerOptions: {
      noEmit: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      inlineSourceMap: false,
      allowImportingTsExtensions: true,
    },
  });
}

/** The source file named by a selector, resolved against the loaded program. */
export function getSourceFile(project: Project, cwd: string, file: string): SourceFile {
  const abs = isAbsolute(file) ? file : join(cwd, file);
  const sf = project.getSourceFile(abs);
  if (!sf) throw new SelectorResolutionError(file, 'source file is not in the loaded program');
  return sf;
}

/**
 * Resolve a {@link Selector} to exactly one declaration node, else throw.
 *
 * v0 handles the common forms: a top-level name and a `Class.member`. The TSDoc
 * disambiguation grammar (`:static`/`:instance`/overload index/constructor) is
 * added when a case demands it (spec §5.2); resolution must always yield one
 * declaration — zero or many is a fail.
 */
export function resolveSelector(project: Project, cwd: string, sel: Selector): Node {
  const sf = getSourceFile(project, cwd, sel.file);
  const [first, ...rest] = collectCandidates(sf, sel.symbol);
  if (!first) throw new SelectorResolutionError(sel.symbol, 'no declaration matched');
  if (rest.length > 0) {
    throw new SelectorResolutionError(sel.symbol, 'ambiguous: matched multiple declarations');
  }
  return first;
}

/**
 * All declarations matching a `file` + `symbol`, without the exactly-one
 * requirement. Used for collision checks (does a target name already exist?).
 */
export function findDeclarations(
  project: Project,
  cwd: string,
  file: string,
  symbol: string,
): Node[] {
  const sf = project.getSourceFile(isAbsolute(file) ? file : join(cwd, file));
  return sf ? collectCandidates(sf, symbol) : [];
}

function defined<T>(x: T | undefined): x is T {
  return x !== undefined;
}

function collectCandidates(sf: SourceFile, symbol: string): Node[] {
  const dot = symbol.indexOf('.');
  return dot === -1
    ? topLevelDeclarations(sf, symbol)
    : memberDeclarations(sf, symbol.slice(0, dot), symbol.slice(dot + 1));
}

function topLevelDeclarations(sf: SourceFile, name: string): Node[] {
  return [
    sf.getFunction(name),
    sf.getClass(name),
    sf.getVariableDeclaration(name),
    sf.getInterface(name),
    sf.getTypeAlias(name),
    sf.getEnum(name),
  ].filter(defined);
}

function memberDeclarations(sf: SourceFile, className: string, member: string): Node[] {
  const cls = sf.getClass(className);
  if (!cls) return [];
  return [
    cls.getMethod(member),
    cls.getProperty(member),
    cls.getGetAccessor(member),
    cls.getSetAccessor(member),
  ].filter(defined);
}
