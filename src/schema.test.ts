import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WaiverSchema, serializeJsonSchema } from './schema.js';

const committed = fileURLToPath(new URL('../schema/waiver-stamp.v0.schema.json', import.meta.url));

describe('JSON Schema generation', () => {
  it('the committed schema/ file matches the Zod-generated output (run `pnpm gen:schema`)', async () => {
    const onDisk = await readFile(committed, 'utf8');
    expect(onDisk).toBe(serializeJsonSchema());
  });
});

describe('WaiverSchema', () => {
  it('rejects an unknown op kind', () => {
    const result = WaiverSchema.safeParse({
      schema: 'waiver-stamp/v0',
      tool: 'waiver-stamp@0.0.0',
      ops: [{ op: 'nope' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects additional top-level properties (strict)', () => {
    const result = WaiverSchema.safeParse({
      schema: 'waiver-stamp/v0',
      tool: 'waiver-stamp@0.0.0',
      ops: [],
      extra: 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty ops list (formatting/type-only changes stamp with no ops)', () => {
    const result = WaiverSchema.safeParse({
      schema: 'waiver-stamp/v0',
      tool: 'waiver-stamp@0.0.0',
      ops: [],
    });
    expect(result.success).toBe(true);
  });
});
