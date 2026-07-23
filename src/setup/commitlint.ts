import type { RunResult } from './run.ts';

type Run = (cmd: string, args: string[], opts?: { input?: string }) => Promise<RunResult>;

/** A valid Conventional Commit whose body stays under commitlint's 100-char default. */
const CONTROL = 'chore: commitlint probe\n\nA short body line, well within the default limit.\n';
/** The same, but with a body line over 100 chars — what a pretty-printed waiver would produce. */
const LONG_BODY = `chore: commitlint probe\n\n${'x'.repeat(120)}\n`;

/**
 * Whether the repo's commitlint would reject a waivered commit's long body lines (§4.7). commitlint
 * config comes in too many shapes to parse, so detect empirically: pipe two synthetic messages
 * through `commitlint` (no real commit) and compare. A control message that itself fails means
 * commitlint isn't cleanly enforcing here (or isn't installed) — so warn only when the control
 * passes and the long-body probe fails, isolating the body-length rule from every other reason.
 */
export async function detectCommitlintBodyLimit(
  cwd: string,
  run: Run,
): Promise<{ blocks: boolean }> {
  const args = ['--no-install', 'commitlint', '--cwd', cwd];
  const control = await run('npx', args, { input: CONTROL });
  if (control.code !== 0) return { blocks: false };
  const probe = await run('npx', args, { input: LONG_BODY });
  return { blocks: probe.code !== 0 };
}
