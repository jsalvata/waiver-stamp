import { describe, expect, it } from 'vitest';
import { handoffPage } from './handoff.ts';

const base = {
  owner: 'jsalvata',
  repo: 'demo',
  slug: 'waiver-stamp-jsalvata',
  defaultBranch: 'main',
  configExisted: false,
  suggestedHonestyCheck: null as string | null,
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

  it('shows the install-confirm step only when an App was provisioned (slug present)', async () => {
    const withApp = handoffPage({ ...base, slug: 'waiver-stamp-jsalvata' });
    expect(withApp).toContain('waiver-stamp-jsalvata');
    expect(withApp).toMatch(/is installed on/i);
    // No slug (--no-app / converged resume): nothing to install, so no step and no broken link.
    const noApp = handoffPage({ ...base, slug: '' });
    expect(noApp).not.toMatch(/is installed on/i);
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
    // No detected check ⇒ no suggestion line.
    expect(
      handoffPage({ ...base, configExisted: true, suggestedHonestyCheck: null }),
    ).not.toContain('lockfileHonestyCheck');
  });
});
