import { afterEach, describe, expect, it } from 'vitest';
import { OpApplicationError, SelectorResolutionError } from '../../errors.js';
import { type Fixture, scaffoldProject } from '../../test-helpers.js';
import { loadProject } from '../project.js';
import { applyMoveFile } from './move-file.js';

let fix: Fixture | undefined;
afterEach(async () => {
  await fix?.cleanup();
  fix = undefined;
});

describe('applyMoveFile', () => {
  it('moves a file and rewrites module specifiers in referencing files', async () => {
    fix = await scaffoldProject({
      'src/orders.ts': 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n',
      'src/usage.ts':
        "import { calculateTotal } from './orders';\nexport const t = calculateTotal(21);\n",
    });
    const project = loadProject(fix.cwd);
    applyMoveFile(project, fix.cwd, {
      op: 'move-file',
      from: 'src/orders.ts',
      to: 'src/billing/orders.ts',
    });

    expect(project.getSourceFile(`${fix.cwd}/src/orders.ts`)).toBeUndefined();
    const moved = project.getSourceFileOrThrow(`${fix.cwd}/src/billing/orders.ts`).getFullText();
    expect(moved).toContain('function calculateTotal');
    const usage = project.getSourceFileOrThrow(`${fix.cwd}/src/usage.ts`).getFullText();
    expect(usage).toContain("from './billing/orders'");
  });

  it("rewrites the moved file's own relative imports", async () => {
    fix = await scaffoldProject({
      'src/orders.ts':
        "import { rate } from './rates';\nexport function calculateTotal(n: number): number {\n  return n * rate;\n}\n",
      'src/rates.ts': 'export const rate = 2;\n',
    });
    const project = loadProject(fix.cwd);
    applyMoveFile(project, fix.cwd, {
      op: 'move-file',
      from: 'src/orders.ts',
      to: 'src/billing/orders.ts',
    });

    const moved = project.getSourceFileOrThrow(`${fix.cwd}/src/billing/orders.ts`).getFullText();
    expect(moved).toContain("from '../rates'");
  });

  it('refuses when a source file already exists at the destination', async () => {
    fix = await scaffoldProject({
      'src/orders.ts': 'export const a = 1;\n',
      'src/billing.ts': 'export const b = 2;\n',
    });
    const project = loadProject(fix.cwd);
    const cwd = fix.cwd;
    expect(() =>
      applyMoveFile(project, cwd, { op: 'move-file', from: 'src/orders.ts', to: 'src/billing.ts' }),
    ).toThrow(OpApplicationError);
  });

  it('fails when the source file is not in the loaded program', async () => {
    fix = await scaffoldProject({ 'src/orders.ts': 'export const a = 1;\n' });
    const project = loadProject(fix.cwd);
    const cwd = fix.cwd;
    expect(() =>
      applyMoveFile(project, cwd, { op: 'move-file', from: 'src/missing.ts', to: 'src/other.ts' }),
    ).toThrow(SelectorResolutionError);
  });
});
