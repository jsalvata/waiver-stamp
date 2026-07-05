import { describe, expect, it, vi } from 'vitest';
import { run } from './main.ts';

const baseDeps = {
  context: {
    payload: {
      workflow_run: {
        head_sha: 'a'.repeat(40),
        head_branch: 'feat',
        repository: { owner: { login: 'o' }, name: 'r' },
      },
    },
  },
  getOctokit: () =>
    ({
      /* fake rest surface */
    }) as never,
  resolvePr: vi.fn(async () => ({ number: 7, base: 'b'.repeat(40) })),
  confirmChecksGreen: vi.fn(async () => ({ ok: true, pending: [], failed: [] })),
  fetchArtifact: vi.fn(async () => ({
    verdict: 'APPROVE',
    base: 'b'.repeat(40),
    head: 'a'.repeat(40),
    toolVersion: '1',
    commits: [],
  })),
  g1: vi.fn(async () => []),
  g2: vi.fn(async () => []),
  postOutcome: vi.fn(async () => {}),
  inputs: { ciChecks: ['CI'], lockfileHonestyChecks: [] as string[] },
};

describe('run', () => {
  it('no open PR → no-op', async () => {
    const deps = { ...baseDeps, resolvePr: vi.fn(async () => null) };
    await run(deps as never);
    expect(deps.postOutcome).not.toHaveBeenCalled();
  });
  it('backstop not green → no-op', async () => {
    const deps = {
      ...baseDeps,
      confirmChecksGreen: vi.fn(async () => ({ ok: false, pending: ['CI'], failed: [] })),
      postOutcome: vi.fn(async () => {}),
    };
    await run(deps as never);
    expect(deps.postOutcome).not.toHaveBeenCalled();
  });
  it('happy path posts an APPROVE outcome', async () => {
    const deps = { ...baseDeps, postOutcome: vi.fn(async () => {}) };
    await run(deps as never);
    expect(deps.postOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: expect.objectContaining({ action: 'APPROVE' }) }),
    );
  });
  it('a collaborator error is fail-closed (no review posted)', async () => {
    const deps = {
      ...baseDeps,
      fetchArtifact: vi.fn(async () => {
        throw new Error('boom');
      }),
      postOutcome: vi.fn(async () => {}),
    };
    await run(deps as never);
    expect(deps.postOutcome).not.toHaveBeenCalled();
  });
  it('artifact head SHA mismatched with the event → no-op (event head is authoritative)', async () => {
    const deps = {
      ...baseDeps,
      fetchArtifact: vi.fn(async () => ({
        verdict: 'APPROVE' as const,
        base: 'b'.repeat(40),
        head: 'c'.repeat(40), // does not match context.workflow_run.head_sha ('a'.repeat(40))
        toolVersion: '1',
        commits: [],
      })),
      postOutcome: vi.fn(async () => {}),
    };
    await run(deps as never);
    expect(deps.postOutcome).not.toHaveBeenCalled();
  });
  it('forged artifact.base (≠ pr.base) → no-op (pr.base is authoritative, not the artifact)', async () => {
    // Exploit shape: producer-writable artifact.base is set to the head SHA itself, which would
    // make commitsInRange(head, head) empty and fabricate a clean guard pass if ever trusted.
    const deps = {
      ...baseDeps,
      fetchArtifact: vi.fn(async () => ({
        verdict: 'APPROVE' as const,
        base: 'a'.repeat(40), // forged: equals headSha, not the real pr.base ('b'.repeat(40))
        head: 'a'.repeat(40),
        toolVersion: '1',
        commits: [],
      })),
      postOutcome: vi.fn(async () => {}),
    };
    await run(deps as never);
    expect(deps.postOutcome).not.toHaveBeenCalled();
  });
  it('happy path: guards are called with pr.base, not artifact.base', async () => {
    const deps = { ...baseDeps, g1: vi.fn(async () => []), g2: vi.fn(async () => []) };
    await run(deps as never);
    expect(deps.g1).toHaveBeenCalledWith(expect.anything(), 'b'.repeat(40), 'a'.repeat(40));
    expect(deps.g2).toHaveBeenCalledWith(expect.anything(), 'b'.repeat(40), 'a'.repeat(40));
  });
});
