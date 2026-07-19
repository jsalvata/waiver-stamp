import { describe, expect, it, vi } from 'vitest';
import { SetupError } from './errors.ts';
import { preflight } from './preflight.ts';

function runner(map: Record<string, { stdout?: string; code?: number }>) {
  return vi.fn(async (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    const hit = Object.entries(map).find(([k]) => key.startsWith(k));
    if (!hit) throw new Error(`unexpected: ${key}`);
    return { stdout: hit[1].stdout ?? '', stderr: '', code: hit[1].code ?? 0 };
  });
}
const ok = {
  'git rev-parse --is-inside-work-tree': { stdout: 'true\n' },
  'git remote get-url origin': { stdout: 'https://github.com/jsalvata/demo.git\n' },
  'git symbolic-ref refs/remotes/origin/HEAD': { stdout: 'refs/remotes/origin/main\n' },
  'gh auth status': { stdout: 'Logged in' },
};

describe('preflight', () => {
  it('resolves owner/repo/defaultBranch and detects pnpm', async () => {
    const r = await preflight('/repo', {
      run: runner(ok),
      exists: async (p: string) => p.endsWith('pnpm-lock.yaml'),
    });
    expect(r).toMatchObject({ owner: 'jsalvata', repo: 'demo', defaultBranch: 'main', pnpm: true });
  });
  it('parses an SSH origin remote', async () => {
    const r = await preflight('/repo', {
      run: runner({
        ...ok,
        'git remote get-url origin': { stdout: 'git@github.com:jsalvata/demo.git\n' },
      }),
      exists: async () => false,
    });
    expect(r).toMatchObject({ owner: 'jsalvata', repo: 'demo', pnpm: false });
  });
  // Each failure path pins its own message so a future refactor can't silently swap one
  // remediation for another — the remediation string is what the user acts on.
  it.each([
    [
      'not inside a git work tree',
      { 'git rev-parse --is-inside-work-tree': { stdout: 'false\n' } },
    ],
    ['git is not installed', { 'git rev-parse --is-inside-work-tree': { code: 127 } }],
    ['no GitHub origin remote', { 'git remote get-url origin': { code: 1 } }],
    [
      'no GitHub origin remote',
      { 'git remote get-url origin': { stdout: 'https://gitlab.com/x/y\n' } },
    ],
    ['gh is not authenticated', { 'gh auth status': { code: 1 } }],
    ['gh is not installed', { 'gh auth status': { code: 127 } }],
  ])('throws SetupError %s', async (message, override) => {
    const err = await preflight('/repo', {
      run: runner({ ...ok, ...override }),
      exists: async () => false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as SetupError).message).toBe(message);
    expect((err as SetupError).remediation).not.toBe('');
  });
});
