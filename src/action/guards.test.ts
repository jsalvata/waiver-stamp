import { describe, expect, it } from 'vitest';
import { changedFiles, runGit } from '../git.ts';
import { makeGitRepo } from '../test-helpers.ts';
import { g1WorkflowIntegrity, g2ManifestEnvelope } from './guards.ts';

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

describe('g2ManifestEnvelope', () => {
  it('passes when no manifest/lockfile change', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit({ 'src/a.ts': 'export const a = 2;' }, 'change');
    expect(await g2ManifestEnvelope(g.repo, base, head)).toEqual([]);
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
    expect((await g2ManifestEnvelope(g.repo, base, head)).length).toBeGreaterThan(0);
  });
});
