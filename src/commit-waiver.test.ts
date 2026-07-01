import { describe, expect, it } from 'vitest';
import { extractWaiverBlock } from './commit-waiver.js';
import { waiverCommitMessage } from './test-helpers.js';
import type { Waiver } from './types.js';

const W: Waiver = { schema: 'waiver-stamp/v0', ops: [] };

describe('extractWaiverBlock — waiver fence (§17.1)', () => {
  it('selects a ```waiver block', () => {
    const block = extractWaiverBlock(waiverCommitMessage('refactor: x', W));
    expect(block.kind).toBe('one');
  });

  it('ignores an incidental ```json block with waiver-shaped content', () => {
    const msg = 'refactor: x\n\n```json\n{"schema":"waiver-stamp/v0","ops":[]}\n```\n';
    expect(extractWaiverBlock(msg).kind).toBe('none');
  });

  it('two ```waiver blocks → invalid', () => {
    const msg = `${waiverCommitMessage('a', W)}\n${waiverCommitMessage('b', W)}`;
    expect(extractWaiverBlock(msg).kind).toBe('invalid');
  });
});
