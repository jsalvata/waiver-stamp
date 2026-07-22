import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reusePage } from './pages.ts';

/**
 * Guide the install step on a reuse run. The fresh path shows its guidance from the loopback
 * done page, but reuse never starts that server — so write the same guidance to a local file and
 * open that. Opening GitHub's install page directly would drop the user onto a page we can't
 * annotate, with no idea which repo to pick or that they're nearly done.
 */
export async function openInstallGuidance(
  installUrl: string,
  repoFullName: string,
  openBrowser: (url: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'waiver-install-'));
  const file = join(dir, 'install.html');
  await writeFile(file, reusePage(installUrl, repoFullName));
  await openBrowser(pathToFileURL(file).href);
}
