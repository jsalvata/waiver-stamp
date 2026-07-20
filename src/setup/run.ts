import { execFile } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Shell a command and capture its output. The single seam every `gh`/`git` caller injects, so
 * tests never touch a real shell. A non-zero exit is returned (not thrown) — callers decide what
 * a failure means. `input`, when set, is written to stdin (used for multiline pem → `gh secret set`).
 */
export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: opts.cwd }, (err, stdout, stderr) => {
      const errCode = (err as { code?: number | string } | null)?.code;
      // A numeric code is a real process exit. A string code (ENOENT, EACCES) means the binary
      // never ran — surface the shell "command not found" convention (127) so callers can tell
      // "not installed" apart from "ran and exited non-zero" and give the right remediation.
      const code =
        typeof errCode === 'number' ? errCode : typeof errCode === 'string' ? 127 : err ? 1 : 0;
      resolve({ stdout, stderr, code });
    });
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}
