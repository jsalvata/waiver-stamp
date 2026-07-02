import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_TSCONFIG_JSON,
  type GitRepoFixture,
  makeGitRepo,
  waiverCommitMessage,
} from './test-helpers.js';
import type { Waiver } from './types.js';
import { verify } from './verify.js';

const ORDERS_BASE = 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n';
const ORDERS_RENAMED = 'export function computeTotal(n: number): number {\n  return n * 2;\n}\n';
const renameWaiver = (): Waiver => ({
  schema: 'waiver-stamp/v0',
  ops: [
    {
      op: 'rename',
      target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
      to: 'computeTotal',
    },
  ],
});

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

describe('verify — single commit (§17.4)', () => {
  it('stamps HEAD when the embedded waiver covers the diff', async () => {
    g = await makeGitRepo();
    await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED },
      waiverCommitMessage('refactor: rename', renameWaiver()),
    );
    const r = await verify({ cwd: g.repo }); // default HEAD
    expect(r.class).toBe('stamped');
  });

  it('an unwaivered HEAD → unwaivered', async () => {
    g = await makeGitRepo();
    await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    await g.commit({ 'src/orders.ts': `${ORDERS_BASE}// note\n` }, 'chore: touch');
    expect((await verify({ cwd: g.repo })).class).toBe('unwaivered');
  });

  it('a root commit is skipped', async () => {
    g = await makeGitRepo();
    const root = await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    const r = await verify({ commit: root, cwd: g.repo });
    expect(r.class).toBe('skipped');
    expect(r.reasons).toContain('root-commit');
  });

  it('an unresolvable commit-ish throws CommitResolutionError', async () => {
    g = await makeGitRepo();
    await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    await expect(verify({ commit: 'nope-not-a-ref', cwd: g.repo })).rejects.toThrow(
      'did not resolve',
    );
  });

  it('a commit with a broken waiver block (invalid JSON) → invalid', async () => {
    g = await makeGitRepo();
    await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    await g.commit(
      { 'src/orders.ts': `${ORDERS_RENAMED}` },
      'refactor: x\n\n```waiver\nnot json at all\n```\n',
    );
    const r = await verify({ cwd: g.repo });
    expect(r.class).toBe('invalid');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
