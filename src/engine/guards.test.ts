import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Fixture, scaffoldProject } from '../test-helpers.js';
import { type Checkout, baseChecks, emitDivergenceGuard, headChecks } from './guards.js';
import { loadProject } from './project.js';

const fixtures: Fixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.map((f) => f.cleanup()));
  fixtures.length = 0;
});

/** Scaffold a project on disk and return it as a guard `Checkout` (auto-cleaned). */
async function checkout(files: Record<string, string>): Promise<Checkout> {
  const fix = await scaffoldProject(files);
  fixtures.push(fix);
  return { project: loadProject(fix.cwd), root: fix.cwd };
}

const renameOp = {
  op: 'rename' as const,
  target: { file: 'src/a.ts', symbol: 'calculateTotal' },
  to: 'computeTotal',
};

const DEFINES_OLD = 'export function calculateTotal(): number {\n  return 1;\n}\n';

const moveFileOp = { op: 'move-file' as const, from: 'src/orders.ts', to: 'src/b/orders.ts' };

describe('baseChecks (over base)', () => {
  it('FAILs when the new name already appears in a string literal (capture)', async () => {
    const base = await checkout({
      'src/a.ts': DEFINES_OLD,
      'src/registry.ts': "export const key = 'computeTotal';\n",
    });
    const findings = baseChecks(base, [renameOp], new Set());
    expect(findings.map((f) => f.guard)).toContain('dynamic-reference');
  });

  it('passes when the new name is not referenced in base', async () => {
    const base = await checkout({
      'src/a.ts': DEFINES_OLD,
      'src/b.ts': "import { calculateTotal } from './a';\nexport const x = calculateTotal();\n",
    });
    expect(baseChecks(base, [renameOp], new Set())).toEqual([]);
  });

  it('does not FAIL on a new-name string confined to an excluded file', async () => {
    const base = await checkout({
      'src/a.ts': DEFINES_OLD,
      'src/a.test.ts': "export const key = 'computeTotal';\n",
    });
    expect(baseChecks(base, [renameOp], new Set(['src/a.test.ts']))).toEqual([]);
  });

  it('does not treat a same-named file in another directory as excluded', async () => {
    const base = await checkout({
      'src/a.ts': DEFINES_OLD,
      'src/a.test.ts': "export const key = 'unrelated';\n",
      'other/src/a.test.ts': "export const key = 'computeTotal';\n",
    });
    // Only 'src/a.test.ts' is confined — the same-named file nested under
    // 'other/' must still be scanned (regression: suffix matching would have
    // wrongly excluded it too).
    const findings = baseChecks(base, [renameOp], new Set(['src/a.test.ts']));
    expect(findings.map((f) => f.guard)).toContain('dynamic-reference');
  });

  it('FAILs a rename targeting a published surface', async () => {
    const base = await checkout({
      'libs/foo-sdk/src/index.ts': DEFINES_OLD,
    });
    const op = {
      ...renameOp,
      target: { file: 'libs/foo-sdk/src/index.ts', symbol: 'calculateTotal' },
    };
    expect(baseChecks(base, [op], new Set()).map((f) => f.guard)).toContain('public-api');
  });

  it('FAILs a move-file whose destination path is already referenced outside an import (capture)', async () => {
    const base = await checkout({
      'src/orders.ts': 'export const a = 1;\n',
      'src/legacy.ts':
        "declare const require: (p: string) => unknown;\nexport const m = require('./b/orders');\n",
    });
    const findings = baseChecks(base, [moveFileOp], new Set());
    expect(findings.map((f) => f.guard)).toContain('dynamic-reference');
  });

  it('passes a move-file whose source is only referenced by static imports', async () => {
    const base = await checkout({
      'src/orders.ts': 'export const a = 1;\n',
      'src/b.ts': "import { a } from './orders';\nexport const x = a;\n",
    });
    expect(baseChecks(base, [moveFileOp], new Set())).toEqual([]);
  });

  it('FAILs a move-file whose source is a published surface', async () => {
    const base = await checkout({
      'libs/foo-sdk/src/index.ts': 'export const a = 1;\n',
    });
    const op = {
      op: 'move-file' as const,
      from: 'libs/foo-sdk/src/index.ts',
      to: 'libs/foo-sdk/src/main.ts',
    };
    expect(baseChecks(base, [op], new Set()).map((f) => f.guard)).toContain('public-api');
  });
});

describe('headChecks (over head)', () => {
  it('FAILs when the old name still appears in a string literal in head (stale)', async () => {
    const head = await checkout({
      'src/a.ts': 'export function computeTotal(): number {\n  return 1;\n}\n',
      'src/registry.ts': "export const key = 'calculateTotal';\n",
    });
    const findings = headChecks(head, [renameOp], new Set());
    expect(findings.map((f) => f.guard)).toContain('dynamic-reference');
  });

  it('passes when the old name is gone from head (string edited away)', async () => {
    const head = await checkout({
      'src/a.ts': 'export function computeTotal(): number {\n  return 1;\n}\n',
      'src/registry.ts': "export const key = 'computeTotal';\n",
    });
    expect(headChecks(head, [renameOp], new Set())).toEqual([]);
  });

  it('does not FAIL on an old-name string confined to an excluded file', async () => {
    const head = await checkout({
      'src/a.ts': 'export function computeTotal(): number {\n  return 1;\n}\n',
      'src/a.test.ts':
        "describe('calculateTotal (integration)', () => {\n  it('works', () => {});\n});\n",
    });
    expect(headChecks(head, [renameOp], new Set(['src/a.test.ts']))).toEqual([]);
  });

  it('still FAILs on an old-name string in a file not covered by any exclusion op', async () => {
    const head = await checkout({
      'src/a.ts': 'export function computeTotal(): number {\n  return 1;\n}\n',
      'src/a.test.ts':
        "describe('calculateTotal (integration)', () => {\n  it('works', () => {});\n});\n",
      'src/other.test.ts': "export const key = 'calculateTotal';\n",
    });
    const findings = headChecks(head, [renameOp], new Set(['src/a.test.ts']));
    expect(findings.map((f) => f.guard)).toContain('dynamic-reference');
  });

  it('FAILs a move-file when the old path is still referenced outside an import in head (stale)', async () => {
    const head = await checkout({
      'src/b/orders.ts': 'export const a = 1;\n',
      'src/legacy.ts':
        "declare const require: (p: string) => unknown;\nexport const m = require('./orders');\n",
    });
    const findings = headChecks(head, [moveFileOp], new Set());
    expect(findings.map((f) => f.guard)).toContain('dynamic-reference');
  });

  it('passes a move-file when head references only the new path (static and dynamic import)', async () => {
    const head = await checkout({
      'src/b/orders.ts': 'export const a = 1;\n',
      'src/c.ts': "import { a } from './b/orders';\nexport const x = a;\n",
      'src/dyn.ts': "export const m = import('./b/orders');\n",
    });
    expect(headChecks(head, [moveFileOp], new Set())).toEqual([]);
  });

  it('does not FAIL on an old-path string confined to an excluded file', async () => {
    const head = await checkout({
      'src/b/orders.ts': 'export const a = 1;\n',
      'src/orders.test.ts': "export const p = './orders';\n",
    });
    expect(headChecks(head, [moveFileOp], new Set(['src/orders.test.ts']))).toEqual([]);
  });
});

describe('emitDivergenceGuard', () => {
  it('FAILs a file containing a const enum', async () => {
    const co = await checkout({ 'src/a.ts': 'export const enum Color {\n  Red,\n  Blue,\n}\n' });
    const findings = emitDivergenceGuard(co.project, [join(co.root, 'src/a.ts')]);
    expect(findings.map((f) => f.guard)).toContain('emit-divergence');
  });

  it('passes a file with a parameter property (accepted shortcoming, spec §8)', async () => {
    const co = await checkout({
      'src/a.ts': 'export class C {\n  constructor(public readonly n: number) {}\n}\n',
    });
    expect(emitDivergenceGuard(co.project, [join(co.root, 'src/a.ts')])).toEqual([]);
  });

  it('passes a plain file', async () => {
    const co = await checkout({ 'src/a.ts': 'export const x = 1;\n' });
    expect(emitDivergenceGuard(co.project, [join(co.root, 'src/a.ts')])).toEqual([]);
  });
});
