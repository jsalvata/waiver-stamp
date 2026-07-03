/**
 * Thin git helpers over the `git` subprocess. The stamper/verifier need to walk
 * a commit range, read full commit messages (the embedded-waiver channel, §17.1),
 * and check refs out into throwaway worktrees to fold over.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CommitResolutionError } from './errors.ts';

const exec = promisify(execFile);

/** Run a git command in `repo`, returning stdout with the trailing newline stripped. */
export async function runGit(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  return stdout.replace(/\n$/, '');
}

/** Resolve a commit-ish to a full SHA; throws CommitResolutionError if it is not a commit. */
export async function resolveCommit(repo: string, ref: string): Promise<string> {
  try {
    return await runGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new CommitResolutionError(ref);
  }
}

/** SHAs in `base..head`, oldest first (excludes base, includes head). */
export async function commitsInRange(repo: string, base: string, head: string): Promise<string[]> {
  const out = await runGit(repo, ['rev-list', '--reverse', `${base}..${head}`]);
  return out ? out.split('\n') : [];
}

/** Parent SHAs of a commit; length ≥ 2 means a merge commit (§17.1). */
export async function parents(repo: string, sha: string): Promise<string[]> {
  const out = await runGit(repo, ['show', '-s', '--format=%P', sha]);
  return out ? out.split(' ') : [];
}

/** Full commit message body (`%B`), untruncated — never the subject alone (§17.1). */
export async function commitMessage(repo: string, sha: string): Promise<string> {
  return runGit(repo, ['show', '-s', '--format=%B', sha]);
}

/** The commit subject line (`%s`). */
export async function commitSubject(repo: string, sha: string): Promise<string> {
  return runGit(repo, ['show', '-s', '--format=%s', sha]);
}

/** Files changed between two refs (`git diff --name-only`). */
export async function changedFiles(repo: string, base: string, head: string): Promise<string[]> {
  const out = await runGit(repo, ['diff', '--name-only', base, head]);
  return out ? out.split('\n') : [];
}

export interface Worktree {
  /** Absolute path to the checked-out tree. */
  dir: string;
  /** Remove the worktree and its temp parent. */
  cleanup: () => Promise<void>;
}

/** Check `ref` out into a throwaway detached worktree the engine can fold over. */
export async function worktreeAt(repo: string, ref: string): Promise<Worktree> {
  const base = await mkdtemp(join(tmpdir(), 'ws-wt-'));
  const dir = join(base, 'tree');
  await runGit(repo, ['worktree', 'add', '--detach', dir, ref]);
  return {
    dir,
    cleanup: async () => {
      await runGit(repo, ['worktree', 'remove', '--force', dir]).catch(() => {});
      await rm(base, { recursive: true, force: true });
    },
  };
}
