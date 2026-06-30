import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stamp } from './stamp.js';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from './test-helpers.js';

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

const RENAME_WAIVER = {
  schema: 'waiver-stamp/v0',
  tool: 'waiver-stamp@0.1.0',
  ops: [
    {
      op: 'rename',
      target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
      to: 'computeTotal',
    },
  ],
};

async function writeWaiver(repo: string, waiver: unknown): Promise<string> {
  const path = join(repo, '.waiver.json');
  await writeFile(path, JSON.stringify(waiver), 'utf8');
  return path;
}

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

describe('stamp', () => {
  it('STAMPS a head that is exactly the reproduced rename', async () => {
    g = await makeGitRepo();
    const base = await baseCommit();
    const head = await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED, 'src/usage.ts': USAGE_RENAMED },
      'rename',
    );
    const report = await stamp(await writeWaiver(g.repo, RENAME_WAIVER), {
      base,
      head,
      cwd: g.repo,
    });
    expect(report.stamped).toBe(true);
    expect(report.uncovered).toEqual([]);
  });

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
    const report = await stamp(await writeWaiver(g.repo, RENAME_WAIVER), {
      base,
      head,
      cwd: g.repo,
    });
    expect(report.stamped).toBe(true);
  });

  it('FAILS when head smuggles a logic change into a reproduced file', async () => {
    g = await makeGitRepo();
    const base = await baseCommit();
    const head = await g.commit(
      {
        'src/orders.ts': 'export function computeTotal(n: number): number {\n  return n * 3;\n}\n',
        'src/usage.ts': USAGE_RENAMED,
      },
      'rename + smuggle',
    );
    const report = await stamp(await writeWaiver(g.repo, RENAME_WAIVER), {
      base,
      head,
      cwd: g.repo,
    });
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toContain('src/orders.ts');
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
    const report = await stamp(await writeWaiver(g.repo, RENAME_WAIVER), {
      base,
      head,
      cwd: g.repo,
    });
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
    const waiver = {
      schema: 'waiver-stamp/v0',
      tool: 'waiver-stamp@0.1.0',
      ops: [
        {
          op: 'rename',
          target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
          to: 'computeTotal',
        },
        { op: 'change-test', files: ['src/orders.test.ts'] },
      ],
    };
    const report = await stamp(await writeWaiver(g.repo, waiver), { base, head, cwd: g.repo });
    expect(report.stamped).toBe(true);
  });

  it('FAILS when a change-test names a non-test (production) file', async () => {
    g = await makeGitRepo();
    const base = await baseCommit();
    const head = await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED, 'src/usage.ts': USAGE_RENAMED },
      'rename',
    );
    const waiver = {
      schema: 'waiver-stamp/v0',
      tool: 'waiver-stamp@0.1.0',
      ops: [{ op: 'change-test', files: ['src/usage.ts'] }],
    };
    const report = await stamp(await writeWaiver(g.repo, waiver), { base, head, cwd: g.repo });
    expect(report.stamped).toBe(false);
  });
});
