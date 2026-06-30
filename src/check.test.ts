import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { check } from './check.js';

const validExample = fileURLToPath(new URL('../examples/valid.waiver.json', import.meta.url));

describe('check', () => {
  it('reports ok for a valid waiver', async () => {
    const result = await check(validExample);
    expect(result.ok).toBe(true);
    expect(result.waiver.ops).toHaveLength(4);
  });
});
