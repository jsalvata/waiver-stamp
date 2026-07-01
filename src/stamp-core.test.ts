/**
 * Integration tests for the §3.1 stamping engine (`stampWaiver`) over real git
 * repos — restored from the pre-split stamp.test.ts (see 85b75ad), which covered
 * these behaviors before `stamp` became the §17.2 range aggregator.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { stampWaiver } from './stamp-core.js';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from './test-helpers.js';
import type { Waiver } from './types.js';

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

describe('stampWaiver (engine integration, §3.1)', () => {
  it('STAMPS even when head reformats the reproduced files (emit is modulo formatting)', async () => {
    g = await makeGitRepo();
    const base = await baseCommit();
    const head = await g.commit(
      {
        'src/orders.ts':
          '/** doc */\nexport function computeTotal(n:number):number{ return n*2; }\n',
        'src/usage.ts': USAGE_RENAMED,
      },
      'rename + reformat',
    );
    const report = await stampWaiver(RENAME_WAIVER, { base, head, cwd: g.repo });
    expect(report.stamped).toBe(true);
  });

  it('FAILS when head adds an un-accounted new production file', async () => {
    g = await makeGitRepo();
    const base = await baseCommit();
    const head = await g.commit(
      {
        'src/orders.ts': ORDERS_RENAMED,
        'src/usage.ts': USAGE_RENAMED,
        'src/sneaky.ts': 'export const leak = 1;\n',
      },
      'rename + sneak',
    );
    const report = await stampWaiver(RENAME_WAIVER, { base, head, cwd: g.repo });
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toContain('src/sneaky.ts');
  });

  it('STAMPS a mixed rename + hand-edited test via change-test exclusion', async () => {
    g = await makeGitRepo();
    const base = await baseCommit({
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
    const report = await stampWaiver(waiver, { base, head, cwd: g.repo });
    expect(report.stamped).toBe(true);
  });

  it('FAILS when a change-test names a non-test (production) file', async () => {
    g = await makeGitRepo();
    const base = await baseCommit();
    const head = await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED, 'src/usage.ts': USAGE_RENAMED },
      'rename',
    );
    const waiver: Waiver = {
      schema: 'waiver-stamp/v0',
      ops: [{ op: 'change-test', files: ['src/usage.ts'] }],
    };
    const report = await stampWaiver(waiver, { base, head, cwd: g.repo });
    expect(report.stamped).toBe(false);
    expect(report.failures.some((f) => f.includes('src/usage.ts'))).toBe(true);
  });
});
