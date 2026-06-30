import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.js';
import { WaiverValidationError } from '../src/errors.js';
import { loadWaiver } from '../src/load.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('loadWaiver', () => {
  it('accepts a schema-valid waiver and returns it parsed', async () => {
    const waiver = await loadWaiver(fixture('valid.waiver.json'));
    expect(waiver.schema).toBe('waiver-stamp/v0');
    expect(waiver.tool).toMatch(/^waiver-stamp@/);
    expect(waiver.ops).toHaveLength(4);
    expect(waiver.ops.map((o) => o.op)).toEqual([
      'rename',
      'extract-function',
      'change-test',
      'change-docs',
    ]);
  });

  it('rejects a waiver with an unknown op kind', async () => {
    await expect(loadWaiver(fixture('invalid.waiver.json'))).rejects.toBeInstanceOf(
      WaiverValidationError,
    );
  });
});

describe('check', () => {
  it('reports ok for a valid waiver', async () => {
    const result = await check(fixture('valid.waiver.json'));
    expect(result.ok).toBe(true);
    expect(result.waiver.ops).toHaveLength(4);
  });
});
