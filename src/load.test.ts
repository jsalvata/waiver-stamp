import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WaiverParseError, WaiverValidationError } from './errors.js';
import { loadWaiver, loadWaiverFromObject } from './load.js';

const validExample = fileURLToPath(new URL('../examples/valid.waiver.json', import.meta.url));

async function writeTemp(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'waiver-'));
  const path = join(dir, name);
  await writeFile(path, content, 'utf8');
  return path;
}

describe('loadWaiver', () => {
  it('accepts a schema-valid waiver and returns it parsed', async () => {
    const waiver = await loadWaiver(validExample);
    expect(waiver.schema).toBe('waiver-stamp/v0');
    expect(waiver.tool).toMatch(/^waiver-stamp@/);
    expect(waiver.ops.map((o) => o.op)).toEqual([
      'rename',
      'extract-function',
      'change-test',
      'change-docs',
    ]);
  });

  it('throws WaiverParseError on non-JSON content', async () => {
    const path = await writeTemp('garbage.json', 'not json {');
    await expect(loadWaiver(path)).rejects.toBeInstanceOf(WaiverParseError);
  });

  it('throws WaiverValidationError on an unknown op kind', async () => {
    const path = await writeTemp(
      'invalid.json',
      JSON.stringify({
        schema: 'waiver-stamp/v0',
        tool: 'waiver-stamp@0.0.0',
        ops: [{ op: 'frobnicate' }],
      }),
    );
    await expect(loadWaiver(path)).rejects.toBeInstanceOf(WaiverValidationError);
  });

  it('WaiverParseError keeps the path as structured data, not in the message', () => {
    const err = new WaiverParseError('/tmp/x.json');
    expect(err.path).toBe('/tmp/x.json');
    expect(err.message).not.toContain('/tmp/x.json');
  });
});

describe('loadWaiverFromObject', () => {
  it('validates an already-parsed object and returns it typed', () => {
    const waiver = loadWaiverFromObject({
      schema: 'waiver-stamp/v0',
      tool: 'waiver-stamp@0.1.0',
      ops: [{ op: 'rename', target: { file: 'src/a.ts', symbol: 'foo' }, to: 'bar' }],
    });
    expect(waiver.ops[0]?.op).toBe('rename');
  });

  it('throws WaiverValidationError on a non-conforming object', () => {
    expect(() => loadWaiverFromObject({ schema: 'waiver-stamp/v0', tool: 'x', ops: [] })).toThrow(
      WaiverValidationError,
    );
  });
});
