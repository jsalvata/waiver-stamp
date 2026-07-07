import { describe, expect, it } from 'vitest';
import { changedFiles, runGit } from '../git.ts';
import { makeGitRepo } from '../test-helpers.ts';
import { g1WorkflowIntegrity, g2DependencyIntegrity } from './guards.ts';

describe('g1WorkflowIntegrity', () => {
  it('passes when no commit touches .github', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit({ 'src/a.ts': 'export const a = 2;' }, 'change');
    expect(await g1WorkflowIntegrity(g.repo, base, head)).toEqual([]);
  });
  it('flags the offending commit even when a later commit reverts it (net diff is clean)', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const bad = await g.commit({ '.github/workflows/ci.yml': 'name: x\n' }, 'add workflow'); // offender
    await runGit(g.repo, ['rm', '.github/workflows/ci.yml']);
    await runGit(g.repo, ['commit', '-m', 'revert workflow']); // reverts: net base→head shows no .github
    const head = await runGit(g.repo, ['rev-parse', 'HEAD']);
    const offenders = await g1WorkflowIntegrity(g.repo, base, head);
    // The add is flagged despite the net-zero diff — the whole point of per-commit scanning.
    // The `git rm` commit is a legitimate second offender (deleting a workflow also touches
    // .github); do not exempt deletions.
    expect(offenders).toContain(bad);
    expect(await changedFiles(g.repo, base, head)).not.toContain('.github/workflows/ci.yml');
  });
});

describe('g2DependencyIntegrity', () => {
  it('passes when no manifest/lockfile change', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit({ 'src/a.ts': 'export const a = 2;' }, 'change');
    expect(await g2DependencyIntegrity(g.repo, base, head)).toEqual([]);
  });
  it('flags an out-of-envelope bump (not allowlisted)', async () => {
    const g = await makeGitRepo();
    const base = await g.commit(
      {
        '.waiver-stamp.json': '{"allowBumping":["lodash"]}',
        'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}',
      },
      'init',
    );
    const head = await g.commit(
      { 'package.json': '{"dependencies":{"left-pad":"^2.0.0"}}' },
      'bump left-pad',
    );
    expect((await g2DependencyIntegrity(g.repo, base, head)).length).toBeGreaterThan(0);
  });

  // The resolution-input catalog — one case per pnpm install-input type. Keep in sync with
  // lockfile-assay's isResolutionInput; narrowing RESOLUTION_INPUTS fails these loudly.
  it.each([
    '.pnpmfile.cjs',
    '.pnpmfile.mjs', // any pnpmfile extension, not just .cjs
    '.npmrc',
    'pnpm-workspace.yaml',
    'package.yaml',
    'package.json5',
    'patches/react@1.0.0.patch',
    'fix.patch',
    'fix.diff',
  ])('flags a resolution-input touch: %s', async (file) => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit({ [file]: 'contents\n' }, `add ${file}`);
    const offenders = await g2DependencyIntegrity(g.repo, base, head);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((o) => o.includes(file))).toBe(true);
  });

  it('does not flag basename-lookalikes (anchoring must not become a substring match)', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit(
      {
        'foo.npmrc': 'not actually an .npmrc\n',
        'notpackage.yaml': 'not actually package.yaml\n',
        'mypnpm-workspace.yaml': 'not actually pnpm-workspace.yaml\n',
      },
      'add basename lookalikes',
    );
    expect(await g2DependencyIntegrity(g.repo, base, head)).toEqual([]);
  });

  it('flags a nested resolution input by basename, at any depth', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit(
      { 'packages/app/.npmrc': 'registry=https://evil.example/\n' },
      'add nested npmrc',
    );
    const offenders = await g2DependencyIntegrity(g.repo, base, head);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((o) => o.includes('packages/app/.npmrc'))).toBe(true);
  });

  it('flags the offending commit even when a later commit reverts it (net diff is clean)', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const bad = await g.commit({ '.pnpmfile.cjs': 'module.exports = {};\n' }, 'add pnpmfile'); // offender
    await runGit(g.repo, ['rm', '.pnpmfile.cjs']);
    await runGit(g.repo, ['commit', '-m', 'revert pnpmfile']); // reverts: net base→head shows none
    const head = await runGit(g.repo, ['rev-parse', 'HEAD']);
    const offenders = await g2DependencyIntegrity(g.repo, base, head);
    // The add is flagged despite the net-zero diff — mirrors G1's per-commit scan.
    expect(offenders.some((o) => o.startsWith(bad.slice(0, 7)))).toBe(true);
    expect(await changedFiles(g.repo, base, head)).not.toContain('.pnpmfile.cjs');
  });

  it('does not flag an unrelated yaml file (no false positives)', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit(
      {
        'src/a.ts': 'export const a = 2;',
        'README.md': '# hi\n',
        'config.yaml': 'key: value\n',
      },
      'unrelated change',
    );
    expect(await g2DependencyIntegrity(g.repo, base, head)).toEqual([]);
  });

  it('honors an allowlisted bump from BASE config (config read via git show, not worktree)', async () => {
    const g = await makeGitRepo();
    const base = await g.commit(
      {
        '.waiver-stamp.json': '{"allowBumping":["left-pad"]}',
        'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}',
      },
      'init',
    );
    const head = await g.commit(
      { 'package.json': '{"dependencies":{"left-pad":"^2.0.0"}}' },
      'bump left-pad',
    );
    expect(await g2DependencyIntegrity(g.repo, base, head)).toEqual([]);
  });

  it('fails closed when package.json is missing at a ref (blob absent, not silently {})', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init'); // no package.json
    const head = await g.commit({ 'package.json': '{"dependencies":{}}' }, 'add package.json');
    await expect(g2DependencyIntegrity(g.repo, base, head)).rejects.toThrow();
  });

  it('flags both a resolution-input touch and an out-of-envelope bump in the same commit', async () => {
    const g = await makeGitRepo();
    const base = await g.commit(
      {
        '.waiver-stamp.json': '{"allowBumping":[]}',
        'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}',
      },
      'init',
    );
    const head = await g.commit(
      {
        'package.json': '{"dependencies":{"left-pad":"^2.0.0"}}',
        '.pnpmfile.cjs': 'module.exports = {};\n',
      },
      'bump + add pnpmfile',
    );
    expect((await g2DependencyIntegrity(g.repo, base, head)).length).toBeGreaterThanOrEqual(2);
  });
});
