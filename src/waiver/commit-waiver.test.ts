import { describe, expect, it } from 'vitest';
import { waiverCommitMessage } from '../test-helpers.ts';
import { extractWaiverBlock } from './commit-waiver.ts';
import type { Waiver } from './types.ts';

const W: Waiver = { schema: 'waiver-stamp/v0', ops: [] };

describe('extractWaiverBlock — waiver fence (§17.1)', () => {
  it('no fenced block at all → none', () => {
    const msg = 'refactor: just a normal commit\n\nbody text';
    expect(extractWaiverBlock(msg)).toEqual({ kind: 'none' });
  });

  it('selects a ```waiver block with deep equality', () => {
    const W_nontrivial: Waiver = {
      schema: 'waiver-stamp/v0',
      ops: [
        {
          op: 'rename',
          target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
          to: 'computeTotal',
        },
      ],
    };
    const block = extractWaiverBlock(waiverCommitMessage('refactor: x', W_nontrivial));
    expect(block).toEqual({ kind: 'one', waiver: W_nontrivial });
  });

  it('ignores an incidental ```json block with waiver-shaped content', () => {
    const msg = 'refactor: x\n\n```json\n{"schema":"waiver-stamp/v0","ops":[]}\n```\n';
    expect(extractWaiverBlock(msg).kind).toBe('none');
  });

  it('```waiver block with non-v0 schema → invalid (§17.1: a present-but-broken claim, never dropped)', () => {
    const msg = 'x\n\n```waiver\n{"schema":"waiver-stamp/v1","ops":[]}\n```\n';
    expect(extractWaiverBlock(msg)).toEqual({
      kind: 'invalid',
      reason: 'waiver block schema is not waiver-stamp/v0',
    });
  });

  it('```waiver block that is not valid JSON → invalid (§17.1: fail closed)', () => {
    const msg = 'x\n\n```waiver\nnot json at all {\n```\n';
    expect(extractWaiverBlock(msg)).toEqual({
      kind: 'invalid',
      reason: 'waiver block is not valid JSON',
    });
  });

  it('```waiver-draft fence is not a waiver block → none (info string must be exactly `waiver`)', () => {
    const msg = 'x\n\n```waiver-draft\n{"schema":"waiver-stamp/v0","ops":[]}\n```\n';
    expect(extractWaiverBlock(msg)).toEqual({ kind: 'none' });
  });

  it('```waiver block with v0 schema but invalid ops → invalid with validation reason', () => {
    const msg = 'x\n\n```waiver\n{"schema":"waiver-stamp/v0","ops":[{"op":"bogus"}]}\n```\n';
    const block = extractWaiverBlock(msg);
    expect(block).toEqual({ kind: 'invalid', reason: 'waiver failed schema validation' });
  });

  it('two ```waiver blocks → invalid', () => {
    const msg = `${waiverCommitMessage('a', W)}\n${waiverCommitMessage('b', W)}`;
    expect(extractWaiverBlock(msg).kind).toBe('invalid');
  });
});
