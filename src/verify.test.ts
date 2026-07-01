import { afterEach, describe, expect, it } from 'vitest';
import { embedWaiver } from './commit-waiver.js';
import type { PerCommitResult } from './report.js';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from './test-helpers.js';
import type { Waiver } from './types.js';
import { aggregate, verify } from './verify.js';

const ORDERS_BASE = 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n';
const USAGE_BASE =
  "import { calculateTotal } from './orders';\nexport const t = calculateTotal(21);\n";
const ORDERS_RENAMED = 'export function computeTotal(n: number): number {\n  return n * 2;\n}\n';
const USAGE_RENAMED =
  "import { computeTotal } from './orders';\nexport const t = computeTotal(21);\n";

function renameWaiver(): Waiver {
  return {
    schema: 'waiver-stamp/v0',
    ops: [
      {
        op: 'rename',
        target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
        to: 'computeTotal',
      },
    ],
  };
}

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

async function base(): Promise<string> {
  if (!g) throw new Error('no repo');
  return g.commit(
    {
      'tsconfig.json': FIXTURE_TSCONFIG_JSON,
      'src/orders.ts': ORDERS_BASE,
      'src/usage.ts': USAGE_BASE,
    },
    'base',
  );
}

describe('verify aggregation (the verdict matrix, §17.2)', () => {
  it('APPROVES when every commit carries a valid waiver', async () => {
    g = await makeGitRepo();
    const b = await base();
    const head = await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED, 'src/usage.ts': USAGE_RENAMED },
      embedWaiver('refactor: rename calculateTotal', renameWaiver()),
    );
    const report = await verify({ base: b, head, cwd: g.repo });
    expect(report.verdict).toBe('APPROVE');
  });

  it('COMMENTS when only some commits have valid waivers', async () => {
    g = await makeGitRepo();
    const b = await base();
    await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED, 'src/usage.ts': USAGE_RENAMED },
      embedWaiver('refactor: rename', renameWaiver()),
    );
    const head = await g.commit(
      { 'src/usage.ts': `${USAGE_RENAMED}export const extra = 1;\n` },
      'chore: add an unwaivered line',
    );
    const report = await verify({ base: b, head, cwd: g.repo });
    expect(report.verdict).toBe('COMMENT');
  });

  it('REQUESTS CHANGES when a commit has a waiver but it is invalid (smuggled change)', async () => {
    g = await makeGitRepo();
    const b = await base();
    const head = await g.commit(
      {
        'src/orders.ts': 'export function computeTotal(n: number): number {\n  return n * 3;\n}\n',
        'src/usage.ts': USAGE_RENAMED,
      },
      embedWaiver('refactor: rename', renameWaiver()),
    );
    const report = await verify({ base: b, head, cwd: g.repo });
    expect(report.verdict).toBe('REQUEST_CHANGES');
  });

  it('ABSTAINS when no commit carries a waiver', async () => {
    g = await makeGitRepo();
    const b = await base();
    const head = await g.commit(
      { 'src/usage.ts': `${USAGE_BASE}export const extra = 1;\n` },
      'chore: a normal edit',
    );
    const report = await verify({ base: b, head, cwd: g.repo });
    expect(report.verdict).toBe('ABSTAIN');
  });
});

describe('aggregate (unit)', () => {
  const mk = (cls: PerCommitResult['class']): PerCommitResult => ({
    sha: 'x',
    subject: 's',
    class: cls,
    reasons: [],
    perOpFindings: [],
    uncoveredFiles: [],
  });

  it('ranks invalid above unwaivered', () => {
    expect(aggregate([mk('stamped'), mk('unwaivered'), mk('invalid')])).toBe('REQUEST_CHANGES');
  });
  it('a merge-skipped commit does not block an otherwise-stamped range', () => {
    expect(aggregate([mk('stamped'), mk('skipped')])).toBe('APPROVE');
  });
});
