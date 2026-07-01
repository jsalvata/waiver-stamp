import { describe, expect, it } from 'vitest';
import { embedWaiver, extractWaiverBlock } from './commit-waiver.js';
import type { Waiver } from './types.js';

const WAIVER: Waiver = {
  schema: 'waiver-stamp/v0',
  ops: [{ op: 'rename', target: { file: 'src/a.ts', symbol: 'foo' }, to: 'bar' }],
};

describe('extractWaiverBlock', () => {
  it('finds a single valid waiver block', () => {
    const block = extractWaiverBlock(embedWaiver('refactor: rename foo', WAIVER));
    expect(block.kind).toBe('one');
    if (block.kind === 'one') expect(block.waiver.ops[0]?.op).toBe('rename');
  });

  it('ignores a decoy json block and selects the waiver by schema', () => {
    const msg = `subject\n\n\`\`\`json\n{"not":"a waiver"}\n\`\`\`\n\n${embedWaiver('x', WAIVER).split('\n\n')[1]}`;
    const block = extractWaiverBlock(msg);
    expect(block.kind).toBe('one');
  });

  it('returns none when there is no json block', () => {
    expect(extractWaiverBlock('refactor: just a normal commit\n\nbody').kind).toBe('none');
  });

  it('returns none for a non-v0 schema (a future waiver this tool ignores)', () => {
    const msg = 'x\n\n```json\n{"schema":"waiver-stamp/v9","ops":[]}\n```\n';
    expect(extractWaiverBlock(msg).kind).toBe('none');
  });

  it('is invalid when two waiver blocks are present', () => {
    const one = embedWaiver('x', WAIVER);
    const block = extractWaiverBlock(`${one}\n${one}`);
    expect(block.kind).toBe('invalid');
  });

  it('is invalid when the waiver block has the schema key but fails validation', () => {
    const msg = 'x\n\n```json\n{"schema":"waiver-stamp/v0","ops":[{"op":"nope"}]}\n```\n';
    const block = extractWaiverBlock(msg);
    expect(block.kind).toBe('invalid');
  });

  it('round-trips embed → extract', () => {
    const block = extractWaiverBlock(embedWaiver('refactor: x', WAIVER));
    expect(block).toEqual({ kind: 'one', waiver: WAIVER });
  });
});
