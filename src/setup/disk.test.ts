import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diskAppPath, readDiskApp, writeDiskApp } from './disk.ts';

describe('disk app store', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'waiver-disk-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('round-trips the credentials', async () => {
    await writeDiskApp('acme', { appId: 42, pem: '-----BEGIN…', slug: 'renamed-by-hand' }, home);
    expect(await readDiskApp('acme', home)).toEqual({
      appId: 42,
      pem: '-----BEGIN…',
      slug: 'renamed-by-hand',
    });
  });

  // A private key at rest: group/other must never be able to read it.
  it('writes the file 0600 inside a 0700 directory', async () => {
    await writeDiskApp('acme', { appId: 1, pem: 'p', slug: 's' }, home);
    expect(statSync(diskAppPath('acme', home)).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.waiver-install')).mode & 0o777).toBe(0o700);
  });

  it('returns null when nothing is saved', async () => {
    expect(await readDiskApp('acme', home)).toBeNull();
  });

  // Hand-edited or truncated files shouldn't crash setup — treat them as "no saved App" so the
  // run falls through to the fresh flow.
  it('returns null on an unreadable or incomplete file', async () => {
    await writeDiskApp('acme', { appId: 1, pem: 'p', slug: 's' }, home);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(diskAppPath('acme', home), '{"app_id": 1}');
    expect(await readDiskApp('acme', home)).toBeNull();
  });

  it('namespaces by owner', async () => {
    await writeDiskApp('acme', { appId: 1, pem: 'p', slug: 's' }, home);
    expect(await readDiskApp('other', home)).toBeNull();
  });
});
