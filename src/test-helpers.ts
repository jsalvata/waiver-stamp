/**
 * Shared test fixtures. Excluded from the published build (tsconfig.build.json)
 * — it is only imported by `*.test.ts`. Scaffolds a throwaway ts-morph-loadable
 * project on disk so engine tests run against a real tsconfig + real files.
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from './git.ts';
import type { Waiver } from './waiver/types.ts';

/**
 * The waiver-stamp repo root — its `node_modules/.bin` holds a real Biome the
 * `lint-fix` op can resolve as a `toolchainRoot`, so `lint-fix` tests exercise the
 * actual linter rather than a stub.
 */
export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * A committable `biome.json` for `lint-fix` fixtures: only import organizing is
 * enabled, so `biome check --write` reorders imports (the §6.1 motivating fix)
 * without formatter/linter noise muddying assertions.
 */
export const FIXTURE_BIOME_JSON = `${JSON.stringify(
  {
    organizeImports: { enabled: true },
    formatter: { enabled: false },
    linter: { enabled: false },
  },
  null,
  2,
)}\n`;

/** A committable `package.json` declaring Biome so the `lint-fix` op's manifest check passes. */
export const FIXTURE_PACKAGE_JSON = `${JSON.stringify(
  { name: 'fixture', devDependencies: { '@biomejs/biome': '^1.9.4' } },
  null,
  2,
)}\n`;

/** A committable `package.json` declaring ESLint so the `lint-fix` op selects it. */
export const FIXTURE_ESLINT_PACKAGE_JSON = `${JSON.stringify(
  { name: 'fixture', devDependencies: { eslint: '^9.0.0' } },
  null,
  2,
)}\n`;

/**
 * Write a stub `eslint` into `<cwd>/node_modules/.bin/eslint` that honors `--fix <files>`
 * by replacing `var` with `const` in each named file. `resolveBin` searches the fixture
 * cwd, so tests resolve this without an eslint devDep on waiver-stamp — which would make
 * this repo's own manifest declare two linters and trip the both-declared ambiguity rule.
 * ESLint's real autofix determinism is an assumed third-party property (spec §9); the stub
 * validates the engine's seam (detection -> `--fix` invocation -> changed-file detection).
 */
export async function installStubEslint(cwd: string): Promise<void> {
  const binDir = join(cwd, 'node_modules', '.bin');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'eslint');
  const script = [
    '#!/usr/bin/env node',
    "const { readFileSync, writeFileSync } = require('node:fs');",
    "const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));",
    'for (const f of files) {',
    "  const before = readFileSync(f, 'utf8');",
    "  const after = before.replace(/\\bvar\\b/g, 'const');",
    '  if (after !== before) writeFileSync(f, after);',
    '}',
    '',
  ].join('\n');
  await writeFile(bin, script, 'utf8');
  await chmod(bin, 0o755);
}

export interface Fixture {
  /** Absolute path to the temp project root (holds tsconfig.json). */
  cwd: string;
  /** Remove the temp project. */
  cleanup: () => Promise<void>;
}

const DEFAULT_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    // Bundler resolution lets fixtures use extensionless relative imports.
    moduleResolution: 'Bundler',
    strict: true,
    declaration: false,
    skipLibCheck: true,
  },
  include: ['**/*.ts'],
};

/** The fixture tsconfig as a committable JSON string (for git-repo fixtures). */
export const FIXTURE_TSCONFIG_JSON = `${JSON.stringify(DEFAULT_TSCONFIG, null, 2)}\n`;

/** Write `files` (path → content) plus a tsconfig into a fresh temp dir. */
export async function scaffoldProject(
  files: Record<string, string>,
  tsconfig: unknown = DEFAULT_TSCONFIG,
): Promise<Fixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'ws-fix-'));
  await writeFile(join(cwd, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(cwd, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return { cwd, cleanup: () => rm(cwd, { recursive: true, force: true }) };
}

export interface GitRepoFixture {
  /** Absolute path to the git repo. */
  repo: string;
  /** Write `files` (path → content), stage, commit; returns the new commit SHA. */
  commit: (files: Record<string, string>, message: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

/** A throwaway git repo with a `commit(files, message)` helper for stamp/verify tests. */
export async function makeGitRepo(): Promise<GitRepoFixture> {
  const repo = await mkdtemp(join(tmpdir(), 'ws-repo-'));
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await runGit(repo, ['config', 'user.name', 'Test']);
  await runGit(repo, ['config', 'commit.gpgsign', 'false']);

  const commit = async (files: Record<string, string>, message: string): Promise<string> => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(repo, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-m', message]);
    return runGit(repo, ['rev-parse', 'HEAD']);
  };

  return { repo, commit, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

/** Build a commit message embedding `waiver` as a ` ```waiver ` block (test-only; §17.1). */
export function waiverCommitMessage(subject: string, waiver: Waiver): string {
  return `${subject}\n\n\`\`\`waiver\n${JSON.stringify(waiver, null, 2)}\n\`\`\`\n`;
}
