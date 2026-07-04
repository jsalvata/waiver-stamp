import { afterEach, describe, expect, it } from 'vitest';
import { OpApplicationError, SelectorResolutionError } from '../../errors.ts';
import { type Fixture, scaffoldProject } from '../../test-helpers.ts';
import { loadProject } from '../project.ts';
import { applyMoveFile } from './move-file.ts';

let fix: Fixture | undefined;
afterEach(async () => {
  await fix?.cleanup();
  fix = undefined;
});

/** NodeNext requires explicit `.js` endings on relative specifiers (unlike the Bundler default). */
const NODENEXT_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    declaration: false,
    skipLibCheck: true,
  },
  include: ['**/*.ts'],
};

/**
 * A repo that writes `.ts` endings in source via `rewriteRelativeImportExtensions`
 * (rewritten to `.js` on emit) — but, like most such repos, omits the
 * `allowImportingTsExtensions` flag that the language service needs before it will
 * *generate* `.ts` specifiers. `loadProject` supplies that flag so a move preserves
 * the repo's `.ts` style instead of downgrading it to `.js`.
 */
const REWRITE_EXT_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    rewriteRelativeImportExtensions: true,
    strict: true,
    declaration: false,
    skipLibCheck: true,
  },
  include: ['**/*.ts'],
};

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

  it('preserves the .js extension when rewriting a referencing specifier under NodeNext', async () => {
    fix = await scaffoldProject(
      {
        'src/orders.ts':
          'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n',
        'src/usage.ts':
          "import { calculateTotal } from './orders.js';\nexport const t = calculateTotal(21);\n",
      },
      NODENEXT_TSCONFIG,
    );
    const project = loadProject(fix.cwd);
    applyMoveFile(project, fix.cwd, {
      op: 'move-file',
      from: 'src/orders.ts',
      to: 'src/billing/orders.ts',
    });

    const usage = project.getSourceFileOrThrow(`${fix.cwd}/src/usage.ts`).getFullText();
    expect(usage).toContain("from './billing/orders.js'");
  });

  it("preserves the .js extension in the moved file's own imports under NodeNext", async () => {
    fix = await scaffoldProject(
      {
        'src/orders.ts':
          "import { rate } from './rates.js';\nexport function calculateTotal(n: number): number {\n  return n * rate;\n}\n",
        'src/rates.ts': 'export const rate = 2;\n',
      },
      NODENEXT_TSCONFIG,
    );
    const project = loadProject(fix.cwd);
    applyMoveFile(project, fix.cwd, {
      op: 'move-file',
      from: 'src/orders.ts',
      to: 'src/billing/orders.ts',
    });

    const moved = project.getSourceFileOrThrow(`${fix.cwd}/src/billing/orders.ts`).getFullText();
    expect(moved).toContain("from '../rates.js'");
  });

  it('preserves the .ts extension when rewriting a referencing specifier under rewriteRelativeImportExtensions', async () => {
    fix = await scaffoldProject(
      {
        'src/orders.ts':
          'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n',
        'src/usage.ts':
          "import { calculateTotal } from './orders.ts';\nexport const t = calculateTotal(21);\n",
      },
      REWRITE_EXT_TSCONFIG,
    );
    const project = loadProject(fix.cwd);
    applyMoveFile(project, fix.cwd, {
      op: 'move-file',
      from: 'src/orders.ts',
      to: 'src/billing/orders.ts',
    });

    const usage = project.getSourceFileOrThrow(`${fix.cwd}/src/usage.ts`).getFullText();
    expect(usage).toContain("from './billing/orders.ts'");
  });

  it("preserves the .ts extension in the moved file's own imports under rewriteRelativeImportExtensions", async () => {
    fix = await scaffoldProject(
      {
        'src/orders.ts':
          "import { rate } from './rates.ts';\nexport function calculateTotal(n: number): number {\n  return n * rate;\n}\n",
        'src/rates.ts': 'export const rate = 2;\n',
      },
      REWRITE_EXT_TSCONFIG,
    );
    const project = loadProject(fix.cwd);
    applyMoveFile(project, fix.cwd, {
      op: 'move-file',
      from: 'src/orders.ts',
      to: 'src/billing/orders.ts',
    });

    const moved = project.getSourceFileOrThrow(`${fix.cwd}/src/billing/orders.ts`).getFullText();
    expect(moved).toContain("from '../rates.ts'");
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
