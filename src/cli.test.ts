/** CLI surface (§10): apply/verify/stamp/mcp are registered; commit/check are gone. */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from './test-helpers.js';

const run = promisify(execFile);

// Invoke tsx's binary directly (rather than `pnpm exec`, which refuses to run
// outside a pnpm workspace dir — the functional test below needs cwd = temp repo).
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX_BIN = `${PROJECT_ROOT}node_modules/.bin/tsx`;
const CLI_ENTRY = `${PROJECT_ROOT}src/cli.ts`;

async function runCli(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return run(TSX_BIN, [CLI_ENTRY, ...args], { cwd, encoding: 'utf8' });
}

/** Lines that introduce a top-level command in commander's default help output. */
function commandNames(helpText: string): string[] {
  const lines = helpText.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'Commands:');
  if (start === -1) return [];
  return lines
    .slice(start + 1)
    .filter((l) => /^ {2}\S/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]!.replace(/\[.*$/, ''));
}

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

describe('CLI surface (§10)', () => {
  it('exposes apply/verify/stamp/mcp and not commit/check', async () => {
    const { stdout } = await runCli(['--help']);
    const names = commandNames(stdout);
    for (const c of ['apply', 'verify', 'stamp', 'mcp']) expect(names).toContain(c);
    for (const c of ['commit', 'check']) expect(names).not.toContain(c);
  });

  it('verify --help shows the optional [commit] argument and --json', async () => {
    const { stdout } = await runCli(['verify', '--help']);
    expect(stdout).toContain('[commit]');
    expect(stdout).toContain('--json');
  });

  it('stamp --help shows required --base/--head', async () => {
    const { stdout } = await runCli(['stamp', '--help']);
    expect(stdout).toContain('--base <ref>');
    expect(stdout).toContain('--head <ref>');
  });

  it('verify with no args on a root-commit-only repo exits 0 and reports skipped', async () => {
    g = await makeGitRepo();
    await g.commit({ 'tsconfig.json': FIXTURE_TSCONFIG_JSON }, 'base');
    const { stdout } = await runCli(['verify', '--json'], g.repo);
    const report = JSON.parse(stdout);
    expect(report.class).toBe('skipped');
  });
});
