import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apply, applyWaiver } from './apply.ts';
import { WaiverValidationError } from './errors.ts';
import {
  FIXTURE_BIOME_JSON,
  FIXTURE_PACKAGE_JSON,
  type Fixture,
  REPO_ROOT,
  scaffoldProject,
} from './test-helpers.ts';

let fix: Fixture | undefined;
afterEach(async () => {
  await fix?.cleanup();
  fix = undefined;
});

async function writeWaiver(cwd: string, waiver: unknown): Promise<string> {
  const path = join(cwd, 'waiver.json');
  await writeFile(path, JSON.stringify(waiver), 'utf8');
  return path;
}

describe('apply', () => {
  it('applies a rename waiver to the working tree and reports changed files', async () => {
    fix = await scaffoldProject({
      'src/orders.ts': 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n',
      'src/usage.ts':
        "import { calculateTotal } from './orders';\nexport const t = calculateTotal(21);\n",
    });
    const waiverPath = await writeWaiver(fix.cwd, {
      schema: 'waiver-stamp/v0',
      ops: [
        {
          op: 'rename',
          target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
          to: 'computeTotal',
        },
      ],
    });

    const result = await apply(waiverPath, { cwd: fix.cwd });

    expect(result.files.sort()).toEqual(['src/orders.ts', 'src/usage.ts']);
    const orders = await readFile(join(fix.cwd, 'src/orders.ts'), 'utf8');
    const usage = await readFile(join(fix.cwd, 'src/usage.ts'), 'utf8');
    expect(orders).toContain('function computeTotal');
    expect(usage).toContain('computeTotal(21)');
    expect(usage).not.toContain('calculateTotal');
  });

  it('applies a lint-fix and reports the file it changed on disk', async () => {
    fix = await scaffoldProject({
      'package.json': FIXTURE_PACKAGE_JSON,
      'biome.json': FIXTURE_BIOME_JSON,
      'src/m.ts': 'export const a = 1;\nexport const b = 2;\n',
      'src/use.ts': "import { b, a } from './m';\nexport const s = a + b;\n",
    });

    // The fixture has no install; resolve the linter from the real repo.
    const result = await applyWaiver(
      { schema: 'waiver-stamp/v0', ops: [{ op: 'lint-fix', files: ['src/use.ts'] }] },
      { cwd: fix.cwd, toolchainRoot: REPO_ROOT },
    );

    expect(result.files).toEqual(['src/use.ts']);
    const use = await readFile(join(fix.cwd, 'src/use.ts'), 'utf8');
    expect(use).toContain('import { a, b }');
  });

  it('rejects an invalid waiver before reaching the engine', async () => {
    fix = await scaffoldProject({ 'src/orders.ts': 'export const x = 1;\n' });
    // An unknown op kind fails schema validation → validation error, never the engine.
    const waiverPath = await writeWaiver(fix.cwd, {
      schema: 'waiver-stamp/v0',
      ops: [{ op: 'nope' }],
    });
    await expect(apply(waiverPath, { cwd: fix.cwd })).rejects.toBeInstanceOf(WaiverValidationError);
  });
});
