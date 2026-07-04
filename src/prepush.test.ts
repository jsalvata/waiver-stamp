import { afterEach, describe, expect, it } from 'vitest';
import { formatDriftReport, parsePushRefs, prepush } from './prepush.ts';
import {
  FIXTURE_TSCONFIG_JSON,
  type GitRepoFixture,
  makeGitRepo,
  waiverCommitMessage,
} from './test-helpers.ts';
import type { Waiver } from './types.ts';

const ZERO = '0'.repeat(40);

// ── Pure ref-line parsing (githooks(5): `<local-ref> <local-sha> <remote-ref> <remote-sha>`) ──

describe('parsePushRefs', () => {
  it('parses a normal ref line into structured fields', () => {
    const refs = parsePushRefs('refs/heads/main aaaa refs/heads/main bbbb\n');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      localRef: 'refs/heads/main',
      localSha: 'aaaa',
      remoteRef: 'refs/heads/main',
      remoteSha: 'bbbb',
      deleted: false,
      newBranch: false,
    });
  });

  it('marks a deletion when the local sha is all-zero', () => {
    const refs = parsePushRefs(`(delete) ${ZERO} refs/heads/gone cccc\n`);
    expect(refs[0]).toMatchObject({ deleted: true });
  });

  it('marks a new branch when the remote sha is all-zero', () => {
    const refs = parsePushRefs(`refs/heads/feat dddd refs/heads/feat ${ZERO}\n`);
    expect(refs[0]).toMatchObject({ deleted: false, newBranch: true });
  });

  it('skips blank and malformed lines, keeps well-formed ones', () => {
    const refs = parsePushRefs('\n  \nrefs/heads/a 1111 refs/heads/a 2222\ngarbage line\n');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.localSha).toBe('1111');
  });
});

// ── Human-readable drift report (shared by the CLI and the plugin hook) ──

describe('formatDriftReport', () => {
  it('names each drifted commit and prints the parent-anchored refresh recipe', () => {
    const report = formatDriftReport([
      {
        parent: 'parentsha',
        result: {
          sha: 'deadbeefcafef00d',
          subject: 'chore: bump lodash',
          class: 'invalid',
          reasons: ['dependency bump not covered: pnpm-lock.yaml does not re-resolve to head'],
          perOpFindings: [],
          uncoveredFiles: ['pnpm-lock.yaml'],
        },
      },
    ]);
    expect(report).toContain('deadbeef');
    expect(report).toContain('chore: bump lodash');
    expect(report).toContain('does not re-resolve to head');
    // The refresh recipe, anchored on the real commit (its parent's lockfile).
    expect(report).toContain('git show deadbeefcafef00d^:pnpm-lock.yaml > pnpm-lock.yaml');
    expect(report).toContain(
      'pnpm install --lockfile-only --ignore-scripts --prefer-frozen-lockfile',
    );
    expect(report).toContain('git commit --amend --no-edit');
  });
});

// ── prepush over a real repo, with the pnpm re-resolve faked (like deps.test.ts) ──

const BASE_LOCK = 'lockfileVersion: "9.0"\n# base resolution\n';
const HEAD_LOCK = 'lockfileVersion: "9.0"\n# head resolution\n';
const ALLOW_JSON = `${JSON.stringify({ allowBumping: ['lodash'] })}\n`;
const EMPTY_WAIVER: Waiver = { schema: 'waiver-stamp/v0', ops: [] };

function pkgJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      name: 'fixture',
      packageManager: 'pnpm@9.0.0',
      dependencies: { lodash: '^1.0.0' },
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

/** Stand-in for pnpm: lands O's lockfile on head's expected bytes. */
async function fakeResolver(dir: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await writeFile(join(dir, 'pnpm-lock.yaml'), HEAD_LOCK, 'utf8');
}

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

async function base(): Promise<string> {
  if (!g) throw new Error('repo not initialized');
  return g.commit(
    {
      'tsconfig.json': FIXTURE_TSCONFIG_JSON,
      'src/a.ts': 'export const a = 1;\n',
      'package.json': pkgJson(),
      'pnpm-lock.yaml': BASE_LOCK,
      '.waiver-stamp.json': ALLOW_JSON,
    },
    'base',
  );
}

describe('prepush', () => {
  it('reports nothing when no outgoing commit is a waivered dependency bump', async () => {
    g = await makeGitRepo();
    await base();
    // A waivered source change — no package.json/lockfile touch → not a candidate.
    await g.commit(
      { 'src/a.ts': 'export const a = 2;\n' },
      waiverCommitMessage('edit a', EMPTY_WAIVER),
    );
    const report = await prepush({ cwd: g.repo, resolveLockfile: fakeResolver });
    expect(report.candidates).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it('passes a covered bump whose lockfile re-resolves to head', async () => {
    g = await makeGitRepo();
    await base();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      waiverCommitMessage('bump lodash', EMPTY_WAIVER),
    );
    const report = await prepush({ cwd: g.repo, resolveLockfile: fakeResolver });
    expect(report.candidates).toEqual([head]);
    expect(report.failures).toEqual([]);
  });

  it('flags a drifted bump whose committed lockfile no longer re-resolves', async () => {
    g = await makeGitRepo();
    await base();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0' } }),
        // The committed lockfile diverges from what the (fake) re-resolve produces.
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n# stale resolution\n',
      },
      waiverCommitMessage('bump lodash', EMPTY_WAIVER),
    );
    const report = await prepush({ cwd: g.repo, resolveLockfile: fakeResolver });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.result.sha).toBe(head);
    expect(report.failures[0]?.result.class).not.toBe('stamped');
  });

  it('ignores an unwaivered dependency bump (no waiver fence → not our concern)', async () => {
    g = await makeGitRepo();
    await base();
    await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0' } }),
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n# stale\n',
      },
      'chore: bump lodash', // plain message, no ```waiver fence
    );
    const report = await prepush({ cwd: g.repo, resolveLockfile: fakeResolver });
    expect(report.candidates).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it('hook mode: inspects only the pushed range from stdin ref lines', async () => {
    g = await makeGitRepo();
    const baseSha = await base();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0' } }),
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n# stale\n',
      },
      waiverCommitMessage('bump lodash', EMPTY_WAIVER),
    );
    const stdin = `refs/heads/main ${head} refs/heads/main ${baseSha}\n`;
    const report = await prepush({ cwd: g.repo, stdin, resolveLockfile: fakeResolver });
    expect(report.candidates).toEqual([head]);
    expect(report.failures).toHaveLength(1);
  });

  it('hook mode: skips deletion pushes (all-zero local sha)', async () => {
    g = await makeGitRepo();
    await base();
    await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0' } }),
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n# stale\n',
      },
      waiverCommitMessage('bump lodash', EMPTY_WAIVER),
    );
    const stdin = `(delete) ${ZERO} refs/heads/gone ${'a'.repeat(40)}\n`;
    const report = await prepush({ cwd: g.repo, stdin, resolveLockfile: fakeResolver });
    expect(report.candidates).toEqual([]);
    expect(report.failures).toEqual([]);
  });
});
