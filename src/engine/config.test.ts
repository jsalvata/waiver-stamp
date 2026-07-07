import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WaiverConfigError } from '../errors.ts';
import { CONFIG_FILENAME, loadConfig, parseConfig } from './config.ts';

async function repoWith(config?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'waiver-cfg-'));
  if (config !== undefined) await writeFile(join(dir, CONFIG_FILENAME), config, 'utf8');
  return dir;
}

describe('loadConfig', () => {
  it('yields the empty config when no file exists', async () => {
    const config = await loadConfig(await repoWith());
    expect(config.changeDocs).toEqual({ allow: [], deny: [] });
    expect(config.allowBumping).toEqual([]);
  });

  it('parses the known keys and defaults the rest', async () => {
    const config = await loadConfig(
      await repoWith('{"allowBumping":["lodash"],"changeDocs":{"allow":["docs/**"]}}'),
    );
    expect(config.allowBumping).toEqual(['lodash']);
    expect(config.changeDocs).toEqual({ allow: ['docs/**'], deny: [] });
  });

  it('throws WaiverConfigError on malformed JSON', async () => {
    await expect(loadConfig(await repoWith('not json {'))).rejects.toBeInstanceOf(
      WaiverConfigError,
    );
  });

  it('throws WaiverConfigError on an unknown top-level key (strict outer)', async () => {
    // Fail closed rather than silently ignore config meant for a newer version.
    await expect(
      loadConfig(await repoWith('{"changeDocs":{},"unknownPolicy":1}')),
    ).rejects.toBeInstanceOf(WaiverConfigError);
  });

  it('throws WaiverConfigError on an unknown key inside changeDocs (strict inner)', async () => {
    await expect(
      loadConfig(await repoWith('{"changeDocs":{"allow":[],"bogus":1}}')),
    ).rejects.toBeInstanceOf(WaiverConfigError);
  });

  it('throws WaiverConfigError when allowBumping is not an array of strings', async () => {
    await expect(loadConfig(await repoWith('{"allowBumping":"lodash"}'))).rejects.toBeInstanceOf(
      WaiverConfigError,
    );
  });
});

describe('parseConfig', () => {
  it('yields the empty config for a null (missing-file) input', () => {
    const config = parseConfig(null);
    expect(config.changeDocs).toEqual({ allow: [], deny: [] });
    expect(config.allowBumping).toEqual([]);
  });

  it('parses the known keys and defaults the rest', () => {
    const config = parseConfig('{"allowBumping":["lodash"],"changeDocs":{"allow":["docs/**"]}}');
    expect(config.allowBumping).toEqual(['lodash']);
    expect(config.changeDocs).toEqual({ allow: ['docs/**'], deny: [] });
  });

  it('throws WaiverConfigError on malformed JSON', () => {
    expect(() => parseConfig('not json {')).toThrow(WaiverConfigError);
  });

  it('throws WaiverConfigError on a schema violation', () => {
    expect(() => parseConfig('{"allowBumping":"lodash"}')).toThrow(WaiverConfigError);
  });
});
