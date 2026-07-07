import { afterEach, describe, expect, it } from 'vitest';
import { OpApplicationError } from '../../errors.ts';
import {
  FIXTURE_BIOME_JSON,
  FIXTURE_ESLINT_PACKAGE_JSON,
  FIXTURE_PACKAGE_JSON,
  type Fixture,
  REPO_ROOT,
  installStubEslint,
  scaffoldProject,
} from '../../test-helpers.ts';
import { loadProject } from '../project.ts';
import { applyLintFix } from './lint-fix.ts';

let fix: Fixture | undefined;
afterEach(async () => {
  await fix?.cleanup();
  fix = undefined;
});

describe('applyLintFix', () => {
  it("sorts a file's imports (a safe fix that emit comparison rightly refuses to absorb)", async () => {
    fix = await scaffoldProject({
      'package.json': FIXTURE_PACKAGE_JSON,
      'biome.json': FIXTURE_BIOME_JSON,
      'src/m.ts': 'export const a = 1;\nexport const b = 2;\n',
      'src/use.ts': "import { b, a } from './m';\nexport const s = a + b;\n",
    });
    const project = loadProject(fix.cwd);

    const changed = applyLintFix(
      project,
      fix.cwd,
      { op: 'lint-fix', files: ['src/use.ts'] },
      REPO_ROOT,
    );

    const use = project.getSourceFileOrThrow(`${fix.cwd}/src/use.ts`).getFullText();
    expect(use).toContain('import { a, b }');
    expect(changed).toEqual(['src/use.ts']);
  });

  it('reports no change when the named files are already clean', async () => {
    fix = await scaffoldProject({
      'package.json': FIXTURE_PACKAGE_JSON,
      'biome.json': FIXTURE_BIOME_JSON,
      'src/m.ts': 'export const a = 1;\nexport const b = 2;\n',
      'src/use.ts': "import { a, b } from './m';\nexport const s = a + b;\n",
    });
    const project = loadProject(fix.cwd);

    const changed = applyLintFix(
      project,
      fix.cwd,
      { op: 'lint-fix', files: ['src/use.ts'] },
      REPO_ROOT,
    );

    expect(changed).toEqual([]);
    const use = project.getSourceFileOrThrow(`${fix.cwd}/src/use.ts`).getFullText();
    expect(use).toBe("import { a, b } from './m';\nexport const s = a + b;\n");
  });

  it('resolves the linter binary from the toolchain root, not the folded tree', async () => {
    // The fixture tree has no node_modules; the real Biome lives under REPO_ROOT.
    fix = await scaffoldProject({
      'package.json': FIXTURE_PACKAGE_JSON,
      'biome.json': FIXTURE_BIOME_JSON,
      'src/m.ts': 'export const a = 1;\nexport const b = 2;\n',
      'src/use.ts': "import { b, a } from './m';\nexport const s = a + b;\n",
    });
    const project = loadProject(fix.cwd);

    const changed = applyLintFix(
      project,
      fix.cwd,
      { op: 'lint-fix', files: ['src/use.ts'] },
      REPO_ROOT,
    );

    expect(changed).toEqual(['src/use.ts']);
    expect(project.getSourceFileOrThrow(`${fix.cwd}/src/use.ts`).getFullText()).toContain(
      'import { a, b }',
    );
  });

  it("FAILs closed when the tree's manifest declares no supported linter", async () => {
    fix = await scaffoldProject({
      'package.json': `${JSON.stringify({ name: 'no-linter' })}\n`,
      'src/use.ts': "import { b, a } from './m';\n",
      'src/m.ts': 'export const a = 1;\nexport const b = 2;\n',
    });
    const project = loadProject(fix.cwd);
    const cwd = fix.cwd;

    expect(() =>
      applyLintFix(project, cwd, { op: 'lint-fix', files: ['src/use.ts'] }, cwd),
    ).toThrow(OpApplicationError);
  });

  it('runs ESLint --fix over the named files and reports the change', async () => {
    fix = await scaffoldProject({
      'package.json': FIXTURE_ESLINT_PACKAGE_JSON,
      'src/use.ts': 'var x = 1;\nexport const s = x;\n',
    });
    await installStubEslint(fix.cwd);
    const project = loadProject(fix.cwd);

    const changed = applyLintFix(
      project,
      fix.cwd,
      { op: 'lint-fix', files: ['src/use.ts'] },
      fix.cwd, // stub eslint lives in the fixture's own node_modules/.bin
    );

    expect(changed).toEqual(['src/use.ts']);
    expect(project.getSourceFileOrThrow(`${fix.cwd}/src/use.ts`).getFullText()).toContain(
      'const x = 1;',
    );
  });

  it('reports no change when ESLint finds nothing to fix', async () => {
    fix = await scaffoldProject({
      'package.json': FIXTURE_ESLINT_PACKAGE_JSON,
      'src/use.ts': 'export const s = 1;\n',
    });
    await installStubEslint(fix.cwd);
    const project = loadProject(fix.cwd);

    const changed = applyLintFix(
      project,
      fix.cwd,
      { op: 'lint-fix', files: ['src/use.ts'] },
      fix.cwd,
    );

    expect(changed).toEqual([]);
    expect(project.getSourceFileOrThrow(`${fix.cwd}/src/use.ts`).getFullText()).toBe(
      'export const s = 1;\n',
    );
  });

  it('FAILs closed when the tree declares both Biome and ESLint (ambiguous toolchain)', async () => {
    fix = await scaffoldProject({
      'package.json': `${JSON.stringify(
        { name: 'fixture', devDependencies: { '@biomejs/biome': '^1.9.4', eslint: '^9.0.0' } },
        null,
        2,
      )}\n`,
      'src/use.ts': 'export const s = 1;\n',
    });
    const project = loadProject(fix.cwd);
    const cwd = fix.cwd;

    // Assert on `.detail`, not just the error class: OpApplicationError's message is a
    // static string, and a missing-bin failure is also an OpApplicationError. Matching the
    // detail proves the throw is the ambiguity check, giving a precise RED before the branch.
    let caught: unknown;
    try {
      applyLintFix(project, cwd, { op: 'lint-fix', files: ['src/use.ts'] }, cwd);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OpApplicationError);
    expect((caught as OpApplicationError).detail).toContain('ambiguous');
  });
});
