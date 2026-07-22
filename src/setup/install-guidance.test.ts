import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openInstallGuidance } from './install-guidance.ts';

describe('openInstallGuidance', () => {
  const installUrl = 'https://github.com/apps/waiver-stamp-o/installations/new';

  it('opens a local page that spells out the install and links to it', async () => {
    let opened = '';
    await openInstallGuidance(installUrl, 'o/r', async (url) => {
      opened = url;
    });
    // A real page the browser can render, not GitHub directly — that's the whole point.
    expect(opened.startsWith('file://')).toBe(true);
    const html = readFileSync(fileURLToPath(opened), 'utf8');
    expect(html).toContain(`href="${installUrl}"`);
    expect(html).toContain('o/r');
    expect(html.toLowerCase()).toContain('select repositories');
  });

  it('propagates an opener failure rather than swallowing it', async () => {
    await expect(
      openInstallGuidance(installUrl, 'o/r', () => Promise.reject(new Error('no opener'))),
    ).rejects.toThrow('no opener');
  });
});
