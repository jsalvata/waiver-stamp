import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest.ts';
import { formPage } from './pages.ts';

describe('formPage', () => {
  const manifest = buildManifest({ owner: 'o', appUrl: 'https://github.com/o/r' });
  const action = 'https://github.com/settings/apps/new?state=abc';

  it('does NOT auto-submit — the user reads the guidance first, then clicks through', () => {
    const html = formPage(action, manifest);
    expect(html).not.toMatch(/onload\s*=/i);
    expect(html).toContain(`action="${action}"`);
    expect(html).toContain('type="submit"');
  });

  // Reuse keys on the org secrets / the slug recorded at creation, never on the name — so the page
  // must not claim a rename costs you reuse.
  it('mentions the name without threatening reuse, which no longer depends on it', () => {
    const html = formPage(action, manifest).toLowerCase();
    expect(html).toContain('name');
    expect(html).toMatch(/renaming won't\s+stop|renaming will not stop/);
    expect(html).not.toMatch(/won't be able to reuse|leave the app name unchanged/);
  });

  // `default_permissions` legitimately rides in the hidden manifest, so assert on the prose.
  it('does not promise a permissions review — GitHub does not show them on that page', () => {
    expect(formPage(action, manifest).toLowerCase()).not.toContain('review the permissions');
  });

  // The name-taken case can't be caught server-side (it happens on GitHub's own create form), so the
  // page before it pre-warns. It must be reuse-first and non-destructive — a shared org App by that
  // name must never be presented as something to delete.
  it('warns about the "name already taken" case, reuse-first, without recommending deletion', () => {
    const html = formPage(action, manifest);
    expect(html.toLowerCase()).toContain('already taken');
    expect(html).toContain('WAIVER_STAMP_APP_ID');
    expect(html.toLowerCase()).toContain("don't delete a shared app");
    // No link that would send an org user to the wrong (personal) App settings. (The form's own
    // action URL legitimately starts with that path, so match the anchor form specifically.)
    expect(html).not.toContain('href="https://github.com/settings/apps"');
  });
});
