import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppCredentials } from './loopback.ts';

const DIR = '.waiver-install';

/** Where the opt-in personal credentials for `owner` live (spec §4.4). */
export function diskAppPath(owner: string, home: string = homedir()): string {
  return join(home, DIR, `${owner.toLowerCase()}.json`);
}

/**
 * The saved App for `owner`, or `null` when there is none. A malformed file also reads as `null`:
 * setup then falls through to the fresh flow rather than dying on someone's hand-edit.
 */
export async function readDiskApp(owner: string, home?: string): Promise<AppCredentials | null> {
  let raw: string;
  try {
    raw = await readFile(diskAppPath(owner, home), 'utf8');
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw) as { app_id?: number; pem?: string; slug?: string };
    if (typeof j.app_id !== 'number' || !j.pem || !j.slug) return null;
    return { appId: j.app_id, pem: j.pem, slug: j.slug };
  } catch {
    return null;
  }
}

/**
 * Persist `owner`'s App credentials. This is the only at-rest copy of the private key, so the
 * directory is 0700 and the file 0600. The `mode` options only bite when the path is created —
 * a re-save over a pre-existing (perhaps loosened) file or dir ignores them — so we `chmod`
 * afterwards to enforce the permissions on every write, not just the first.
 */
export async function writeDiskApp(
  owner: string,
  creds: AppCredentials,
  home?: string,
): Promise<void> {
  const path = diskAppPath(owner, home);
  const dir = join(path, '..');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const body = JSON.stringify({ app_id: creds.appId, pem: creds.pem, slug: creds.slug }, null, 2);
  await writeFile(path, `${body}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
