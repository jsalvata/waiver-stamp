import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Fixture, scaffoldProject } from '../test-helpers.js';
import { emitDivergenceGuard, runReproductiveGuards } from './guards.js';
import { loadProject } from './project.js';

let fix: Fixture | undefined;
afterEach(async () => {
  await fix?.cleanup();
  fix = undefined;
});

const renameOp = {
  op: 'rename' as const,
  target: { file: 'src/a.ts', symbol: 'calculateTotal' },
  to: 'computeTotal',
};

describe('runReproductiveGuards', () => {
  it('FAILs when the symbol name appears in a string literal (dynamic reference)', async () => {
    fix = await scaffoldProject({
      'src/a.ts': 'export function calculateTotal(): number {\n  return 1;\n}\n',
      'src/registry.ts':
        'export const handlers: Record<string, unknown> = { calculateTotal: 1 };\nexport const key = "calculateTotal";\n',
    });
    const findings = runReproductiveGuards(loadProject(fix.cwd), [renameOp]);
    expect(findings.map((f) => f.guard)).toContain('dynamic-reference');
  });

  it('passes when no string literal mentions the symbol', async () => {
    fix = await scaffoldProject({
      'src/a.ts': 'export function calculateTotal(): number {\n  return 1;\n}\n',
      'src/b.ts': "import { calculateTotal } from './a';\nexport const x = calculateTotal();\n",
    });
    expect(runReproductiveGuards(loadProject(fix.cwd), [renameOp])).toEqual([]);
  });

  it('FAILs a rename targeting a published surface', async () => {
    fix = await scaffoldProject({
      'libs/foo-sdk/src/index.ts': 'export function calculateTotal(): number {\n  return 1;\n}\n',
    });
    const op = {
      ...renameOp,
      target: { file: 'libs/foo-sdk/src/index.ts', symbol: 'calculateTotal' },
    };
    expect(runReproductiveGuards(loadProject(fix.cwd), [op]).map((f) => f.guard)).toContain(
      'public-api',
    );
  });
});

describe('emitDivergenceGuard', () => {
  it('FAILs a file containing a const enum', async () => {
    fix = await scaffoldProject({ 'src/a.ts': 'export const enum Color {\n  Red,\n  Blue,\n}\n' });
    const findings = emitDivergenceGuard(loadProject(fix.cwd), [join(fix.cwd, 'src/a.ts')]);
    expect(findings.map((f) => f.guard)).toContain('emit-divergence');
  });

  it('FAILs a file with a parameter property', async () => {
    fix = await scaffoldProject({
      'src/a.ts': 'export class C {\n  constructor(public readonly n: number) {}\n}\n',
    });
    const findings = emitDivergenceGuard(loadProject(fix.cwd), [join(fix.cwd, 'src/a.ts')]);
    expect(findings.map((f) => f.guard)).toContain('emit-divergence');
  });

  it('passes a plain file', async () => {
    fix = await scaffoldProject({ 'src/a.ts': 'export const x = 1;\n' });
    expect(emitDivergenceGuard(loadProject(fix.cwd), [join(fix.cwd, 'src/a.ts')])).toEqual([]);
  });
});
