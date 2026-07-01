import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractWaiverBlock } from './commit-waiver.js';
import { commitWaiver } from './commit.js';
import { DirtyTreeError } from './errors.js';
import { commitMessage } from './git.js';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from './test-helpers.js';

const ORDERS = 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n';
const USAGE = "import { calculateTotal } from './orders';\nexport const t = calculateTotal(21);\n";
const WAIVER = {
  schema: 'waiver-stamp/v0',
  ops: [
    {
      op: 'rename',
      target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
      to: 'computeTotal',
    },
  ],
};

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

async function setup(): Promise<string> {
  if (!g) throw new Error('no repo');
  await g.commit(
    { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS, 'src/usage.ts': USAGE },
    'base',
  );
  const waiverPath = join(g.repo, '.waiver.json');
  await writeFile(waiverPath, JSON.stringify(WAIVER), 'utf8');
  return waiverPath;
}

describe('commitWaiver', () => {
  it('applies the waiver and lands a commit that round-trips it', async () => {
    g = await makeGitRepo();
    const waiverPath = await setup();
    const { sha } = await commitWaiver(waiverPath, {
      subject: 'refactor: rename calculateTotal',
      cwd: g.repo,
    });

    const message = await commitMessage(g.repo, sha);
    expect(message).toContain('refactor: rename calculateTotal');
    const block = extractWaiverBlock(message);
    expect(block.kind).toBe('one');

    const orders = await readFile(join(g.repo, 'src/orders.ts'), 'utf8');
    expect(orders).toContain('function computeTotal');
  });

  it('refuses on a dirty working tree', async () => {
    g = await makeGitRepo();
    const waiverPath = await setup();
    await writeFile(join(g.repo, 'src/usage.ts'), `${USAGE}// dirty\n`, 'utf8');
    await expect(commitWaiver(waiverPath, { cwd: g.repo })).rejects.toBeInstanceOf(DirtyTreeError);
  });
});
