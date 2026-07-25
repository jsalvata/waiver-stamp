import { describe, expect, it } from 'vitest';
import { handoffPage } from './handoff.ts';

const base = {
  owner: 'jsalvata',
  repo: 'demo',
  slug: 'waiver-stamp-jsalvata',
  defaultBranch: 'main',
  configExisted: false,
  suggestedHonestyCheck: null as string | null,
  producerOnDefault: true,
  caveats: [] as string[],
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
    // No slug (--no-app / converged resume): nothing to install, so no step and no broken link.
    const noApp = handoffPage({ ...base, slug: '' });
    expect(noApp.toLowerCase()).not.toContain('only select repositories');
    expect(noApp).not.toContain('/apps//');
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
    const html = handoffPage({ ...base, producerOnDefault: false });
    expect(html).toContain('Almost done');
    expect(html).toMatch(/re-run/i);
    // It must follow every step that edits repo content (the .waiver-stamp.json review) and the
    // settings steps — i.e. it's last.
    expect(html.indexOf('re-run')).toBeGreaterThan(html.indexOf('.waiver-stamp.json'));
    expect(html.indexOf('re-run')).toBeGreaterThan(html.indexOf('.github/**'));
  });

  it('omits the merge/re-run step and reads as complete once the producer is on the default branch', async () => {
    const html = handoffPage({ ...base, producerOnDefault: true });
    expect(html).toContain('Setup complete');
    expect(html).not.toMatch(/re-run/i);
  });

  it('renders caveats as their own section, page-only, or nothing when there are none', async () => {
    const withCaveats = handoffPage({
      ...base,
      caveats: ['commitlint rejects long body lines; set body-max-line-length: [0].'],
    });
    expect(withCaveats).toContain('Caveats');
    expect(withCaveats).toContain('body-max-line-length');
    expect(handoffPage({ ...base, caveats: [] })).not.toContain('Caveats');
  });
});
