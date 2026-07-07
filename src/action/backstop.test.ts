import { describe, expect, it } from 'vitest';
import { confirmChecksGreen } from './backstop.ts';

function fakeOctokit(runs: Array<{ name: string; status: string; conclusion: string | null }>) {
  return {
    paginate: async () => runs,
    rest: { checks: { listForRef: {} } },
  } as never;
}

describe('confirmChecksGreen', () => {
  const args = { owner: 'o', repo: 'r', headSha: 'a'.repeat(40) };
  it('ok when all required checks are successful', async () => {
    const ok = await confirmChecksGreen(
      fakeOctokit([{ name: 'CI', status: 'completed', conclusion: 'success' }]),
      { ...args, required: ['CI'] },
    );
    expect(ok).toEqual({ ok: true, pending: [], failed: [] });
  });
  it('not ok, pending, when a required check has not completed', async () => {
    const r = await confirmChecksGreen(
      fakeOctokit([{ name: 'CI', status: 'in_progress', conclusion: null }]),
      { ...args, required: ['CI'] },
    );
    expect(r.ok).toBe(false);
    expect(r.pending).toEqual(['CI']);
  });
  it('not ok, failed, when a required check concluded non-success', async () => {
    const r = await confirmChecksGreen(
      fakeOctokit([{ name: 'CI', status: 'completed', conclusion: 'failure' }]),
      { ...args, required: ['CI'] },
    );
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(['CI']);
  });
  it('not ok, pending, when a required check is entirely absent', async () => {
    const r = await confirmChecksGreen(fakeOctokit([]), { ...args, required: ['CI'] });
    expect(r.ok).toBe(false);
    expect(r.pending).toEqual(['CI']);
  });
});
