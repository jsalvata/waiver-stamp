import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { apply } from './apply.js';
import { NotImplementedError } from './errors.js';

const validExample = fileURLToPath(new URL('../examples/valid.waiver.json', import.meta.url));

describe('apply (stub)', () => {
  it('validates the waiver then reports not-implemented', async () => {
    await expect(apply(validExample, { cwd: process.cwd() })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it('rejects an invalid waiver before reaching the engine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'waiver-'));
    const path = join(dir, 'invalid.json');
    // tool 'x' fails the `waiver-stamp@…` pattern → validation error, never the engine.
    await writeFile(
      path,
      JSON.stringify({ schema: 'waiver-stamp/v0', tool: 'x', ops: [] }),
      'utf8',
    );
    await expect(apply(path, { cwd: process.cwd() })).rejects.not.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
