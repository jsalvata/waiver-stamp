import { describe, expect, it } from 'vitest';
import { parseArtifact } from './schema.ts';

const valid = JSON.stringify({
  verdict: 'APPROVE',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  toolVersion: '1.8.2',
  commits: [
    {
      sha: 'c'.repeat(40),
      subject: 'x',
      class: 'stamped',
      reasons: [],
      perOpFindings: [],
      uncoveredFiles: [],
    },
  ],
});

describe('parseArtifact', () => {
  it('accepts a well-formed report', () => {
    expect(parseArtifact(valid).verdict).toBe('APPROVE');
  });
  it('rejects an unknown verdict', () => {
    const bad = valid.replace('APPROVE', 'YOLO');
    expect(() => parseArtifact(bad)).toThrow();
  });
  it('rejects a non-40-char head', () => {
    const bad = JSON.parse(valid);
    bad.head = 'short';
    expect(() => parseArtifact(JSON.stringify(bad))).toThrow();
  });
});
