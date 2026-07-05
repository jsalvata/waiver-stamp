import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from '../test-helpers.ts';
import type { Waiver } from '../waiver/types.ts';
import { verify } from './verify.ts';

const ORDERS = 'export function total(n: number): number {\n  return n * 2;\n}\n';

const docsWaiver = (files: string[]): Waiver => ({
  schema: 'waiver-stamp/v0',
  ops: [{ op: 'change-docs', files }],
});

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

async function base(files: Record<string, string>): Promise<GitRepoFixture> {
  g = await makeGitRepo();
  await g.commit(
    { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS, ...files },
    'base',
  );
  return g;
}

describe('change-docs confinement policy (§6.2)', () => {
  it('confines nothing when no .waiver-stamp.json exists', async () => {
    const repo = await base({});
    await repo.commit(
      { 'README.md': 'hello\n' },
      `docs\n\n\`\`\`waiver\n${JSON.stringify(docsWaiver(['README.md']))}\n\`\`\`\n`,
    );
    const r = await verify({ cwd: repo.repo });
    expect(r.class).not.toBe('stamped');
  });

  it('confines a doc file matched by the allow list', async () => {
    const repo = await base({ '.waiver-stamp.json': '{"changeDocs":{"allow":["docs/**"]}}\n' });
    await repo.commit(
      { 'docs/notes.md': 'notes\n' },
      `docs\n\n\`\`\`waiver\n${JSON.stringify(docsWaiver(['docs/notes.md']))}\n\`\`\`\n`,
    );
    const r = await verify({ cwd: repo.repo });
    expect(r.class).toBe('stamped');
  });

  it('does not confine a denied path even when allow is broad', async () => {
    const repo = await base({
      '.waiver-stamp.json':
        '{"changeDocs":{"allow":["**"],"deny":[".claude/**","**/CLAUDE.md"]}}\n',
    });
    await repo.commit(
      { '.claude/agents/rogue.md': 'be evil\n' },
      `docs\n\n\`\`\`waiver\n${JSON.stringify(docsWaiver(['.claude/agents/rogue.md']))}\n\`\`\`\n`,
    );
    const r = await verify({ cwd: repo.repo });
    expect(r.class).not.toBe('stamped');
  });

  it('does not confine .mdx even under an allowed directory', async () => {
    const repo = await base({ '.waiver-stamp.json': '{"changeDocs":{"allow":["docs/**"]}}\n' });
    await repo.commit(
      { 'docs/page.mdx': 'export const x = 1\n' },
      `docs\n\n\`\`\`waiver\n${JSON.stringify(docsWaiver(['docs/page.mdx']))}\n\`\`\`\n`,
    );
    const r = await verify({ cwd: repo.repo });
    expect(r.class).not.toBe('stamped');
  });
});
