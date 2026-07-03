import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changedFiles, commitMessage, commitsInRange, parents, runGit, worktreeAt } from './git.ts';

let repo: string;

async function commit(file: string, content: string, message: string): Promise<string> {
  await writeFile(join(repo, file), content, 'utf8');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-m', message]);
  return runGit(repo, ['rev-parse', 'HEAD']);
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'ws-git-'));
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await runGit(repo, ['config', 'user.name', 'Test']);
  await runGit(repo, ['config', 'commit.gpgsign', 'false']);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('git helpers', () => {
  it('lists commits in a range oldest-first', async () => {
    const c0 = await commit('a.txt', '0', 'first');
    const c1 = await commit('a.txt', '1', 'second');
    const c2 = await commit('a.txt', '2', 'third');
    const range = await commitsInRange(repo, c0, c2);
    expect(range).toEqual([c1, c2]);
  });

  it('reads the full multi-line commit message body', async () => {
    const body = 'subject line\n\nbody paragraph\n\n```json\n{"schema":"waiver-stamp/v0"}\n```\n';
    const sha = await commit('a.txt', '0', body);
    const message = await commitMessage(repo, sha);
    expect(message).toContain('```json');
    expect(message).toContain('"schema":"waiver-stamp/v0"');
    expect(message).toContain('body paragraph');
  });

  it('reports a single parent for a normal commit', async () => {
    await commit('a.txt', '0', 'first');
    const sha = await commit('a.txt', '1', 'second');
    const ps = await parents(repo, sha);
    expect(ps).toHaveLength(1);
  });

  it('lists files changed between two refs', async () => {
    const c0 = await commit('a.txt', '0', 'first');
    const c1 = await commit('b.txt', 'new', 'add b');
    expect(await changedFiles(repo, c0, c1)).toEqual(['b.txt']);
  });

  it('checks a ref out into a throwaway worktree', async () => {
    const c0 = await commit('a.txt', 'original', 'first');
    await commit('a.txt', 'changed', 'second');
    const wt = await worktreeAt(repo, c0);
    try {
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(join(wt.dir, 'a.txt'), 'utf8')).toBe('original');
    } finally {
      await wt.cleanup();
    }
  });
});
