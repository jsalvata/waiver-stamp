import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Open a page we generate but GitHub can't host — write the HTML to a temp file and open its
 * `file://` URL. `openBrowser` only takes a URL, so any local page (install guidance, the hand-off)
 * routes through here rather than being handed raw markup.
 */
export async function openLocalPage(
  html: string,
  openBrowser: (url: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'waiver-setup-'));
  const file = join(dir, 'page.html');
  await writeFile(file, html);
  await openBrowser(pathToFileURL(file).href);
}
