import { describe, expect, it } from 'vitest';
import { donePage } from './pages.ts';

describe('donePage', () => {
  const url = 'https://github.com/apps/waiver-stamp-o/installations/new';

  it('forwards to the install page in the same tab (no second browser tab needed)', () => {
    const html = donePage(url);
    expect(html).toMatch(
      /http-equiv="refresh"[^>]*url=https:\/\/github\.com\/apps\/waiver-stamp-o/,
    );
  });

  it('keeps a manual install link as a fallback and guides the click', () => {
    const html = donePage(url);
    expect(html).toContain(`href="${url}"`);
    expect(html.toLowerCase()).toContain('install');
  });
});
