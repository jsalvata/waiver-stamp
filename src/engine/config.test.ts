import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WaiverConfigError } from '../errors.ts';
import { CONFIG_FILENAME, loadDocPolicy } from './config.ts';

async function repoWith(config?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'waiver-cfg-'));
  if (config !== undefined) await writeFile(join(dir, CONFIG_FILENAME), config, 'utf8');
  return dir;
}

describe('loadDocPolicy', () => {
  it('permits nothing when no config file exists', async () => {
    const policy = await loadDocPolicy(await repoWith());
    expect(policy.permits('docs/guide.md')).toBe(false);
    expect(policy.permits('README.md')).toBe(false);
  });

  it('permits nothing when allow is empty', async () => {
    const policy = await loadDocPolicy(await repoWith('{"changeDocs":{"allow":[],"deny":[]}}'));
    expect(policy.permits('docs/guide.md')).toBe(false);
  });

  it('permits files matching an allow glob', async () => {
    const policy = await loadDocPolicy(await repoWith('{"changeDocs":{"allow":["docs/**"]}}'));
    expect(policy.permits('docs/guide.md')).toBe(true);
    expect(policy.permits('docs/nested/deep.md')).toBe(true);
    expect(policy.permits('src/notes.md')).toBe(false);
  });

  it('denies a file even when it is also allowed (deny wins)', async () => {
    const policy = await loadDocPolicy(
      await repoWith('{"changeDocs":{"allow":["**"],"deny":[".claude/**","**/CLAUDE.md"]}}'),
    );
    expect(policy.permits('docs/guide.md')).toBe(true);
    expect(policy.permits('.claude/skills/x/SKILL.md')).toBe(false);
    expect(policy.permits('CLAUDE.md')).toBe(false);
    expect(policy.permits('packages/app/CLAUDE.md')).toBe(false);
  });

  it('throws WaiverConfigError on malformed JSON', async () => {
    await expect(loadDocPolicy(await repoWith('not json {'))).rejects.toBeInstanceOf(
      WaiverConfigError,
    );
  });

  it('tolerates sibling top-level keys (allowBumping etc. are parsed elsewhere)', async () => {
    const policy = await loadDocPolicy(
      await repoWith('{"allowBumping":["lodash"],"changeDocs":{"allow":["docs/**"]}}'),
    );
    expect(policy.permits('docs/guide.md')).toBe(true);
  });

  it('throws WaiverConfigError on an unknown key inside changeDocs (strict)', async () => {
    await expect(
      loadDocPolicy(await repoWith('{"changeDocs":{"allow":[],"bogus":1}}')),
    ).rejects.toBeInstanceOf(WaiverConfigError);
  });
});
