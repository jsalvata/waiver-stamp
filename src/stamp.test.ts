import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NotImplementedError } from './errors.js';
import { stamp } from './stamp.js';

const validExample = fileURLToPath(new URL('../examples/valid.waiver.json', import.meta.url));

describe('stamp (stub)', () => {
  it('validates the waiver then reports not-implemented', async () => {
    await expect(stamp(validExample, { base: 'main', head: 'HEAD' })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
