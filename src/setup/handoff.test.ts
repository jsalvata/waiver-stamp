import { describe, expect, it } from 'vitest';
import { handoffPage } from './handoff.ts';

const base = {
  owner: 'jsalvata',
  repo: 'demo',
  slug: 'waiver-stamp-jsalvata',
  defaultBranch: 'main',
  installDetected: false,
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

  it('shows the install-confirm step only when the install was not detected', async () => {
    expect(handoffPage({ ...base, installDetected: false })).toContain('waiver-stamp-jsalvata');
    expect(handoffPage({ ...base, installDetected: false }).toLowerCase()).toContain('install');
    const detected = handoffPage({ ...base, installDetected: true });
    expect(detected).not.toMatch(/is installed on/i);
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
