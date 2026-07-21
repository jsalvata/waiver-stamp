import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest.ts';
import { donePage, formPage } from './pages.ts';

describe('formPage', () => {
  const manifest = buildManifest({ owner: 'o', appUrl: 'https://github.com/o/r' });
  const action = 'https://github.com/settings/apps/new?state=abc';

  it('does NOT auto-submit — the user reads the guidance first, then clicks through', () => {
    const html = formPage(action, manifest);
    expect(html).not.toMatch(/onload\s*=/i);
    expect(html).toContain(`action="${action}"`);
    expect(html).toContain('type="submit"');
  });

  it('warns that renaming the App breaks reuse across repos', () => {
    const html = formPage(action, manifest).toLowerCase();
    expect(html).toContain('name');
    expect(html).toContain('reuse');
  });
});

describe('donePage', () => {
  const url = 'https://github.com/apps/waiver-stamp-o/installations/new';

  it('links the install page (same tab) without auto-forwarding past the guidance', () => {
    const html = donePage(url, 'o/r');
    expect(html).toContain(`href="${url}"`);
    expect(html).not.toMatch(/http-equiv="refresh"/i);
  });

  it('spells out what to select on the install page, naming the repo', () => {
    const html = donePage(url, 'o/r');
    expect(html).toContain('o/r');
    expect(html.toLowerCase()).toContain('select repositories');
    expect(html.toLowerCase()).toContain('install');
  });
});
