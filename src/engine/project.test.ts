import { afterEach, describe, expect, it } from 'vitest';
import { SelectorResolutionError } from '../errors.ts';
import { type Fixture, scaffoldProject } from '../test-helpers.ts';
import { loadProject, resolveSelector } from './project.ts';

let fix: Fixture | undefined;
afterEach(async () => {
  await fix?.cleanup();
  fix = undefined;
});

describe('resolveSelector', () => {
  it('resolves a top-level function declaration', async () => {
    fix = await scaffoldProject({
      'src/orders.ts': 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n',
    });
    const project = loadProject(fix.cwd);
    const node = resolveSelector(project, fix.cwd, {
      file: 'src/orders.ts',
      symbol: 'calculateTotal',
    });
    expect(node.getKindName()).toBe('FunctionDeclaration');
  });

  it('resolves a class method via Class.member', async () => {
    fix = await scaffoldProject({
      'src/cart.ts': 'export class Cart {\n  total(): number {\n    return 0;\n  }\n}\n',
    });
    const project = loadProject(fix.cwd);
    const node = resolveSelector(project, fix.cwd, { file: 'src/cart.ts', symbol: 'Cart.total' });
    expect(node.getKindName()).toBe('MethodDeclaration');
  });

  it('throws when the symbol does not exist', async () => {
    fix = await scaffoldProject({ 'src/orders.ts': 'export const x = 1;\n' });
    const project = loadProject(fix.cwd);
    const cwd = fix.cwd;
    expect(() => resolveSelector(project, cwd, { file: 'src/orders.ts', symbol: 'nope' })).toThrow(
      SelectorResolutionError,
    );
  });

  it('throws when the source file is not in the program', async () => {
    fix = await scaffoldProject({ 'src/orders.ts': 'export const x = 1;\n' });
    const project = loadProject(fix.cwd);
    const cwd = fix.cwd;
    expect(() => resolveSelector(project, cwd, { file: 'src/missing.ts', symbol: 'x' })).toThrow(
      SelectorResolutionError,
    );
  });
});
