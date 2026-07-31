import { describe, expect, it } from 'vitest';
import { type Caveat, handoffPage } from './handoff.ts';

const base = {
  owner: 'jsalvata',
  repo: 'demo',
  slug: 'waiver-stamp-jsalvata',
  defaultBranch: 'main',
  configExisted: false,
  suggestedHonestyCheck: null as string | null,
  // Default to the "finishing" state — the page that carries the full checklist. The complete-state
  // tests set this true explicitly.
  producerOnDefault: false,
  writtenFiles: [] as string[],
  caveats: [] as Caveat[],
};

describe('handoffPage', () => {
  it('interpolates the repo and links the setup doc once', async () => {
    const html = handoffPage(base);
    expect(html).toContain('jsalvata/demo');
    expect(html).toContain('.waiver-stamp.json');
    // Keep per-commit waivers: the merge-method step names squash as the thing to avoid.
    expect(html.toLowerCase()).toContain('squash');
    expect(html).toContain('docs/auto-approval-setup.md');
  });

  it('shows the install step (with instructions) only when an App was provisioned', async () => {
    const withApp = handoffPage({ ...base, slug: 'waiver-stamp-jsalvata' });
    expect(withApp).toContain('waiver-stamp-jsalvata');
    expect(withApp.toLowerCase()).toContain('only select repositories');
    expect(withApp).toContain('/apps/waiver-stamp-jsalvata/installations/new');
    // No wishy-washy hedge — the step only renders when the install is actually needed …
    expect(withApp.toLowerCase()).not.toContain("if you haven't yet");
    // … and it ends by sending the user back to this page from the install tab.
    expect(withApp.toLowerCase()).toContain('close that tab to come back here');
    // No slug (--no-app / converged resume): nothing to install, so no step and no broken link.
    const noApp = handoffPage({ ...base, slug: '' });
    expect(noApp.toLowerCase()).not.toContain('only select repositories');
    expect(noApp).not.toContain('/apps//');
  });

  it('opens its action links in a new tab so the page survives being clicked', async () => {
    const html = handoffPage(base);
    // Every external link must be target=_blank — clicking one otherwise navigates the hand-off
    // tab away and loses the remaining steps.
    for (const href of html.matchAll(/<a href="[^"]+"([^>]*)>/g))
      expect(href[1]).toContain('target="_blank"');
    // The merge-method step deep-links to the merge-button section, not the top of Settings.
    expect(html).toContain('/settings#merge-button-settings');
  });

  it('suggests the lockfileHonestyCheck edit only when an existing config lacks it', async () => {
    const suggested = handoffPage({
      ...base,
      configExisted: true,
      suggestedHonestyCheck: 'lockfile-honesty',
    });
    expect(suggested).toContain('lockfileHonestyCheck');
    expect(suggested).toContain('lockfile-honesty');
    expect(
      handoffPage({ ...base, configExisted: true, suggestedHonestyCheck: null }),
    ).not.toContain('lockfileHonestyCheck');
  });

  it('adds the commit/merge/re-run step last when the producer is not yet on the default branch', async () => {
    const html = handoffPage({
      ...base,
      producerOnDefault: false,
      writtenFiles: [
        '.github/workflows/waiver-stamp-ci.yml',
        '.github/workflows/waiver-stamp-review.yml',
        '.waiver-stamp.json',
      ],
    });
    expect(html).toContain('Finish setup');
    expect(html).toMatch(/re-run/i);
    // The commit step names every written file in a copy-pasteable `git add`.
    expect(html).toContain(
      'git add .github/workflows/waiver-stamp-ci.yml .github/workflows/waiver-stamp-review.yml .waiver-stamp.json',
    );
    // It must follow every step that edits repo content (the .waiver-stamp.json review) and the
    // settings steps — i.e. it's last.
    const reRun = html.toLowerCase().indexOf('re-run');
    expect(reRun).toBeGreaterThan(html.indexOf('.waiver-stamp.json'));
    expect(reRun).toBeGreaterThan(html.indexOf('.github/**'));
  });

  it('drops the finishing steps and just confirms once the producer is on the default branch', async () => {
    const html = handoffPage({ ...base, producerOnDefault: true });
    expect(html).toContain('Setup complete');
    expect(html).not.toMatch(/re-run/i);
    // The standing adopter choices are dropped — setup is done, not "complete, but do these 3".
    expect(html.toLowerCase()).not.toContain('squash');
    expect(html).not.toContain('.waiver-stamp.json');
    expect(html).not.toContain('.github/**');
    // A short confirmation stands in their place.
    expect(html).toMatch(/ruleset is in place/i);
  });

  it('still shows the install step on a complete page when an App was just provisioned', async () => {
    // Rare: the callers are pre-placed on the default branch, so a first run lands on "Setup
    // complete" with a freshly provisioned App that still needs installing.
    const html = handoffPage({ ...base, producerOnDefault: true, slug: 'waiver-stamp-x' });
    expect(html).toContain('/apps/waiver-stamp-x/installations/new');
    expect(html.toLowerCase()).toContain('close that tab to come back here');
  });

  it('renders caveats as their own section, page-only, or nothing when there are none', async () => {
    const withCaveats = handoffPage({
      ...base,
      caveats: [{ text: 'commitlint rejects long body lines; set body-max-line-length: [0].' }],
    });
    expect(withCaveats).toContain('Caveats');
    expect(withCaveats).toContain('body-max-line-length');
    expect(handoffPage({ ...base, caveats: [] })).not.toContain('Caveats');
  });

  it('renders a caveat doc pointer as a version-pinned new-tab link', async () => {
    const html = handoffPage({
      ...base,
      caveats: [
        {
          text: 'lint-fix unavailable.',
          doc: { href: 'https://x/blob/v9.9.9/y#z', label: 'spec §6.1' },
        },
      ],
    });
    expect(html).toContain('<a href="https://x/blob/v9.9.9/y#z" target="_blank" rel="noopener">');
    expect(html).toContain('spec §6.1');
  });
});
