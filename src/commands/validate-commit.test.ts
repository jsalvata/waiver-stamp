/**
 * Integration tests for the §3.1 stamping engine (`validateCommit`) over real git
 * repos — restored from the pre-split stamp.test.ts (see 85b75ad), which covered
 * these behaviors before `stamp` became the §17.2 range aggregator.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_BIOME_JSON,
  FIXTURE_PACKAGE_JSON,
  FIXTURE_TSCONFIG_JSON,
  type GitRepoFixture,
  REPO_ROOT,
  makeGitRepo,
} from '../test-helpers.ts';
import type { Waiver } from '../waiver/types.ts';
import { validateCommit } from './validate-commit.ts';

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

const ORDERS_BASE = 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n';
const USAGE_BASE =
  "import { calculateTotal } from './orders';\nexport const t = calculateTotal(21);\n";
const ORDERS_RENAMED = 'export function computeTotal(n: number): number {\n  return n * 2;\n}\n';
const USAGE_RENAMED =
  "import { computeTotal } from './orders';\nexport const t = computeTotal(21);\n";

const RENAME_WAIVER: Waiver = {
  schema: 'waiver-stamp/v0',
  ops: [
    {
      op: 'rename',
      target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
      to: 'computeTotal',
    },
  ],
};

async function baseCommit(extra: Record<string, string> = {}): Promise<string> {
  if (!g) throw new Error('repo not initialized');
  return g.commit(
    {
      'tsconfig.json': FIXTURE_TSCONFIG_JSON,
      'src/orders.ts': ORDERS_BASE,
      'src/usage.ts': USAGE_BASE,
      ...extra,
    },
    'base',
  );
}

describe('validateCommit (engine integration, §3.1)', () => {
  it('STAMPS even when head reformats the reproduced files (emit is modulo formatting)', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'src/orders.ts':
          '/** doc */\nexport function computeTotal(n:number):number{ return n*2; }\n',
        'src/usage.ts': USAGE_RENAMED,
      },
      'rename + reformat',
    );
    const report = await validateCommit(RENAME_WAIVER, { commit: head, cwd: g.repo });
    expect(report.stamped).toBe(true);
  });

  it('FAILS when head adds an un-accounted new production file', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'src/orders.ts': ORDERS_RENAMED,
        'src/usage.ts': USAGE_RENAMED,
        'src/sneaky.ts': 'export const leak = 1;\n',
      },
      'rename + sneak',
    );
    const report = await validateCommit(RENAME_WAIVER, { commit: head, cwd: g.repo });
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toContain('src/sneaky.ts');
  });

  it('STAMPS a mixed rename + hand-edited test via change-test exclusion', async () => {
    g = await makeGitRepo();
    await baseCommit({
      'src/orders.test.ts':
        "import { calculateTotal } from './orders';\nexport const ok = calculateTotal(1) === 2;\n",
    });
    const head = await g.commit(
      {
        'src/orders.ts': ORDERS_RENAMED,
        'src/usage.ts': USAGE_RENAMED,
        'src/orders.test.ts':
          "import { computeTotal } from './orders';\nexport const ok = computeTotal(1) === 2;\nexport const extra = computeTotal(2) === 4;\n",
      },
      'rename + edit test',
    );
    const waiver: Waiver = {
      schema: 'waiver-stamp/v0',
      ops: [
        {
          op: 'rename',
          target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
          to: 'computeTotal',
        },
        { op: 'change-test', files: ['src/orders.test.ts'] },
      ],
    };
    const report = await validateCommit(waiver, { commit: head, cwd: g.repo });
    expect(report.stamped).toBe(true);
  });

  it('STAMPS a move-file whose head relocates the file and rewires the importer', async () => {
    g = await makeGitRepo();
    await baseCommit();
    await rm(join(g.repo, 'src/orders.ts'));
    const head = await g.commit(
      {
        'src/billing/orders.ts': ORDERS_BASE,
        'src/usage.ts':
          "import { calculateTotal } from './billing/orders';\nexport const t = calculateTotal(21);\n",
      },
      'move orders under billing/',
    );
    const waiver: Waiver = {
      schema: 'waiver-stamp/v0',
      ops: [{ op: 'move-file', from: 'src/orders.ts', to: 'src/billing/orders.ts' }],
    };
    const report = await validateCommit(waiver, { commit: head, cwd: g.repo });
    expect(report.failures).toEqual([]);
    expect(report.stamped).toBe(true);
  });

  it('FAILS a move-file when head forgets to rewire the importer', async () => {
    g = await makeGitRepo();
    await baseCommit();
    await rm(join(g.repo, 'src/orders.ts'));
    const head = await g.commit(
      { 'src/billing/orders.ts': ORDERS_BASE },
      'move orders, stale importer',
    );
    const waiver: Waiver = {
      schema: 'waiver-stamp/v0',
      ops: [{ op: 'move-file', from: 'src/orders.ts', to: 'src/billing/orders.ts' }],
    };
    const report = await validateCommit(waiver, { commit: head, cwd: g.repo });
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toContain('src/usage.ts');
  });

  // A base whose importer's imports fall out of sort order *after* a move-file
  // rewrites the moved specifier — the §6.1 dogfooding scenario (a move sweep
  // leaves imports unsorted; the follow-up organize-imports fix isn't emit-neutral).
  async function lintBaseCommit(): Promise<string> {
    if (!g) throw new Error('repo not initialized');
    return g.commit(
      {
        'tsconfig.json': FIXTURE_TSCONFIG_JSON,
        'package.json': FIXTURE_PACKAGE_JSON,
        'biome.json': FIXTURE_BIOME_JSON,
        'src/orders.ts': ORDERS_BASE,
        'src/rate.ts': 'export const rate = 3;\n',
        // Unsorted only once './orders' becomes './billing/orders' (b < r).
        'src/usage.ts':
          "import { rate } from './rate';\nimport { calculateTotal } from './orders';\nexport const t = calculateTotal(21) * rate;\n",
      },
      'base',
    );
  }
  const MOVE_AND_LINT: Waiver = {
    schema: 'waiver-stamp/v0',
    ops: [
      { op: 'move-file', from: 'src/orders.ts', to: 'src/billing/orders.ts' },
      { op: 'lint-fix', files: ['src/usage.ts'] },
    ],
  };

  it('STAMPS a move-file + lint-fix commit whose imports were reordered by the fix', async () => {
    g = await makeGitRepo();
    await lintBaseCommit();
    await rm(join(g.repo, 'src/orders.ts'));
    const head = await g.commit(
      {
        'src/billing/orders.ts': ORDERS_BASE,
        // Moved specifier + imports sorted — exactly what apply would produce.
        'src/usage.ts':
          "import { calculateTotal } from './billing/orders';\nimport { rate } from './rate';\nexport const t = calculateTotal(21) * rate;\n",
      },
      'move orders under billing/ and sort imports',
    );
    const report = await validateCommit(MOVE_AND_LINT, {
      commit: head,
      cwd: g.repo,
      toolchainRoot: REPO_ROOT,
    });
    expect(report.failures).toEqual([]);
    expect(report.stamped).toBe(true);
  });

  it('FAILS when a hand edit rides along with the lint fix (emit mismatches O)', async () => {
    g = await makeGitRepo();
    await lintBaseCommit();
    await rm(join(g.repo, 'src/orders.ts'));
    const head = await g.commit(
      {
        'src/billing/orders.ts': ORDERS_BASE,
        // Sorted imports, but a smuggled 21 -> 22 change the lint fix can't account for.
        'src/usage.ts':
          "import { calculateTotal } from './billing/orders';\nimport { rate } from './rate';\nexport const t = calculateTotal(22) * rate;\n",
      },
      'move + sort + smuggle a value change',
    );
    const report = await validateCommit(MOVE_AND_LINT, {
      commit: head,
      cwd: g.repo,
      toolchainRoot: REPO_ROOT,
    });
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toContain('src/usage.ts');
  });

  it('FAILS when a change-test names a non-test (production) file', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED, 'src/usage.ts': USAGE_RENAMED },
      'rename',
    );
    const waiver: Waiver = {
      schema: 'waiver-stamp/v0',
      ops: [{ op: 'change-test', files: ['src/usage.ts'] }],
    };
    const report = await validateCommit(waiver, { commit: head, cwd: g.repo });
    expect(report.stamped).toBe(false);
    expect(report.failures.some((f) => f.includes('src/usage.ts'))).toBe(true);
  });
});
