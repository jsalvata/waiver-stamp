import { afterEach, describe, expect, it } from 'vitest';
import { OpApplicationError } from '../../errors.js';
import { type Fixture, scaffoldProject } from '../../test-helpers.js';
import { loadProject } from '../project.js';
import { applyRename } from './rename.js';

let fix: Fixture | undefined;
afterEach(async () => {
  await fix?.cleanup();
  fix = undefined;
});

describe('applyRename', () => {
  it('renames a function and all cross-file references', async () => {
    fix = await scaffoldProject({
      'src/orders.ts': 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n',
      'src/usage.ts':
        "import { calculateTotal } from './orders';\nexport const t = calculateTotal(21);\n",
    });
    const project = loadProject(fix.cwd);
    applyRename(project, fix.cwd, {
      op: 'rename',
      target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
      to: 'computeTotal',
    });

    const orders = project.getSourceFileOrThrow(`${fix.cwd}/src/orders.ts`).getFullText();
    const usage = project.getSourceFileOrThrow(`${fix.cwd}/src/usage.ts`).getFullText();
    expect(orders).toContain('function computeTotal');
    expect(usage).toContain('computeTotal(21)');
    expect(usage).not.toContain('calculateTotal');
  });

  it('renames a class method and its call sites', async () => {
    fix = await scaffoldProject({
      'src/cart.ts':
        'export class Cart {\n  total(): number {\n    return 0;\n  }\n  describe(): number {\n    return this.total();\n  }\n}\n',
    });
    const project = loadProject(fix.cwd);
    applyRename(project, fix.cwd, {
      op: 'rename',
      target: { file: 'src/cart.ts', symbol: 'Cart.total' },
      to: 'sum',
    });
    const cart = project.getSourceFileOrThrow(`${fix.cwd}/src/cart.ts`).getFullText();
    expect(cart).toContain('sum(): number');
    expect(cart).toContain('this.sum()');
  });

  it('refuses when the target name already exists in scope', async () => {
    fix = await scaffoldProject({
      'src/orders.ts':
        'export function calculateTotal(): number {\n  return 1;\n}\nexport function computeTotal(): number {\n  return 2;\n}\n',
    });
    const project = loadProject(fix.cwd);
    const cwd = fix.cwd;
    expect(() =>
      applyRename(project, cwd, {
        op: 'rename',
        target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
        to: 'computeTotal',
      }),
    ).toThrow(OpApplicationError);
  });
});
