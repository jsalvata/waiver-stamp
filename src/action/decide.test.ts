import { describe, expect, it } from 'vitest';
import { decideReview } from './decide.ts';

const base = {
  guardsPass: true,
  backstopGreen: true,
  lockfileHonestyConfigured: false,
  bumpingAllowed: true,
};

describe('decideReview (§5 matrix)', () => {
  it('backstop not green → NONE (no-op), any verdict', () => {
    expect(decideReview({ ...base, verdict: 'APPROVE', backstopGreen: false }).action).toBe('NONE');
  });
  it('APPROVE + bumping allowed + no honesty check → APPROVE with lockfile warning', () => {
    const o = decideReview({ ...base, verdict: 'APPROVE' });
    expect(o.action).toBe('APPROVE');
    expect(o.body).toContain('assumes the lockfile is honest');
  });
  it('APPROVE + bumping allowed + honesty check configured → APPROVE without the warning', () => {
    const o = decideReview({ ...base, verdict: 'APPROVE', lockfileHonestyConfigured: true });
    expect(o.action).toBe('APPROVE');
    expect(o.body).not.toContain('assumes the lockfile is honest');
  });
  it('APPROVE + bumping not allowed → APPROVE without the warning, regardless of honesty check', () => {
    const noBump = { ...base, bumpingAllowed: false, verdict: 'APPROVE' as const };
    expect(decideReview(noBump).body).not.toContain('assumes the lockfile is honest');
    expect(
      decideReview({ ...noBump, lockfileHonestyConfigured: true }).body,
    ).not.toContain('assumes the lockfile is honest');
  });
  it('APPROVE + guards fail → REQUEST_CHANGES, no artifact content echoed', () => {
    const o = decideReview({ ...base, verdict: 'APPROVE', guardsPass: false });
    expect(o.action).toBe('REQUEST_CHANGES');
    expect(o.body).toContain('refuted');
  });
  it('COMMENT + guards pass → COMMENT (vouched subset)', () => {
    expect(decideReview({ ...base, verdict: 'COMMENT' }).action).toBe('COMMENT');
  });
  it('COMMENT + guards fail → COMMENT (generic, no subset)', () => {
    const o = decideReview({ ...base, verdict: 'COMMENT', guardsPass: false });
    expect(o.action).toBe('COMMENT');
    expect(o.body).toContain('could not verify');
  });
  it('REQUEST_CHANGES (honest invalid) → NONE, guards either way', () => {
    expect(decideReview({ ...base, verdict: 'REQUEST_CHANGES' }).action).toBe('NONE');
    expect(decideReview({ ...base, verdict: 'REQUEST_CHANGES', guardsPass: false }).action).toBe(
      'NONE',
    );
  });
  it('ABSTAIN → NONE', () => {
    expect(decideReview({ ...base, verdict: 'ABSTAIN' }).action).toBe('NONE');
  });
});
