import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply.js';
import { check } from '../src/check.js';
import { NotImplementedError, WaiverParseError } from '../src/errors.js';
import { stamp } from '../src/stamp.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('engine stubs', () => {
  it('apply validates the waiver then reports not-implemented', async () => {
    await expect(
      apply(fixture('valid.waiver.json'), { cwd: process.cwd() }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('stamp validates the waiver then reports not-implemented', async () => {
    await expect(
      stamp(fixture('valid.waiver.json'), { base: 'main', head: 'HEAD' }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('a missing/garbage file path surfaces a parse or read error, never a stamp', async () => {
    await expect(check(fixture('does-not-exist.json'))).rejects.toBeDefined();
  });

  it('apply still rejects an invalid waiver before reaching the engine', async () => {
    // The invalid fixture fails schema validation, so we never reach NotImplemented.
    await expect(
      apply(fixture('invalid.waiver.json'), { cwd: process.cwd() }),
    ).rejects.not.toBeInstanceOf(NotImplementedError);
  });

  it('WaiverParseError carries the offending path as structured data', () => {
    const err = new WaiverParseError('/tmp/x.json');
    expect(err.path).toBe('/tmp/x.json');
    expect(err.message).not.toContain('/tmp/x.json');
  });
});
