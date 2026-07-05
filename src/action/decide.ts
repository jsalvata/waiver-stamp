import type { Verdict } from '../commands/report.ts';

export interface DecideInput {
  verdict: Verdict;
  guardsPass: boolean;
  backstopGreen: boolean;
  lockfileHonestyConfigured: boolean;
}
export interface Outcome {
  action: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | 'NONE';
  body: string;
}

const LOCKFILE_WARNING =
  '\n\n> ⚠️ waiver-stamp assumes the lockfile is honest; wire a lockfile-honesty check into ' +
  '`lockfile-honesty-checks` to remove this caveat.';

/** The spec §5 decision table. Pure — no I/O. */
export function decideReview(i: DecideInput): Outcome {
  // REQUEST_CHANGES / ABSTAIN never produce a review (the red check / absent claim cover them).
  if (i.verdict === 'REQUEST_CHANGES' || i.verdict === 'ABSTAIN')
    return { action: 'NONE', body: '' };

  // Guards failing while a positive claim stands is the only case guards change.
  if (!i.guardsPass) {
    if (i.verdict === 'APPROVE') {
      return {
        action: 'REQUEST_CHANGES',
        body: 'waiver-stamp: the trusted layer refuted this APPROVE claim (a `.github/**` or out-of-envelope manifest change). Full human review applies.',
      };
    }
    return {
      action: 'COMMENT',
      body: 'waiver-stamp: could not verify these results (workflow/manifest changes); full human review applies.',
    };
  }

  // Guards pass — but an APPROVE only removes review once the backstop is green.
  if (!i.backstopGreen) return { action: 'NONE', body: '' };

  if (i.verdict === 'APPROVE') {
    const warn = i.lockfileHonestyConfigured ? '' : LOCKFILE_WARNING;
    return {
      action: 'APPROVE',
      body: `waiver-stamp: every commit is mechanically stamped — this PR is fully accounted for.${warn}`,
    };
  }
  return {
    action: 'COMMENT',
    body: 'waiver-stamp: some commits are mechanically stamped; the rest still need a human.',
  };
}
