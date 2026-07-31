import { describe, expect, it, vi } from 'vitest';
import { detectCommitlintBodyLimit } from './commitlint.ts';
import type { RunResult } from './run.ts';

const ok: RunResult = { stdout: '', stderr: '', code: 0 };
const fail: RunResult = { stdout: '', stderr: 'body-max-line-length', code: 1 };

/** True when the piped message carries a body line over the 100-char default limit. */
const hasLongBody = (input?: string) => (input ?? '').split('\n').some((l) => l.length > 100);

describe('detectCommitlintBodyLimit', () => {
  it('reports blocks when commitlint accepts a short body but rejects a long one', async () => {
    const run = vi.fn(async (_c: string, _a: string[], opts?: { input?: string }) =>
      hasLongBody(opts?.input) ? fail : ok,
    );
    expect(await detectCommitlintBodyLimit('/repo', run)).toEqual({ blocks: true });
  });

  it('does not report blocks when commitlint accepts a long body (limit disabled)', async () => {
    const run = vi.fn(async () => ok);
    expect(await detectCommitlintBodyLimit('/repo', run)).toEqual({ blocks: false });
  });

  // A repo without commitlint makes the probe fail for a reason unrelated to body length; the
  // control message fails too, so we must NOT warn about a config that isn't there.
  it('does not report blocks when even a well-formed control message fails (commitlint absent)', async () => {
    const run = vi.fn(async () => fail);
    expect(await detectCommitlintBodyLimit('/repo', run)).toEqual({ blocks: false });
  });

  it('runs commitlint in the repo, feeding the message on stdin (no real commit)', async () => {
    const run = vi.fn(async (_c: string, _a: string[], opts?: { input?: string }) =>
      hasLongBody(opts?.input) ? fail : ok,
    );
    await detectCommitlintBodyLimit('/repo', run);
    for (const call of run.mock.calls) {
      expect(call[0]).toBe('npx');
      expect(call[1]).toEqual(['--no-install', 'commitlint', '--cwd', '/repo']);
      expect(typeof call[2]?.input).toBe('string');
    }
  });
});
