import type { Verdict } from '../commands/report.ts';

export interface DecideInput {
  verdict: Verdict;
  guardsPass: boolean;
  backstopGreen: boolean;
  lockfileHonestyConfigured: boolean;
  /** Whether the base config allows any dependency bump (empty ⇒ lockfile honesty is moot). */
  bumpingAllowed: boolean;
}
export interface Outcome {
  action: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | 'NONE';
  body: string;
}

/**
 * Every body below starts with this. review.ts's self-heal recognizes the action's own
 * stale reviews by it — token identity can't be used instead: installation tokens (the
 * default GITHUB_TOKEN and create-github-app-token outputs alike) 403 on GET /user, and
 * no endpoint reveals their own bot login.
 */
export const REVIEW_BODY_MARKER = 'waiver-stamp:';

const LOCKFILE_WARNING =
  '\n\n> ⚠️ waiver-stamp assumes the lockfile is honest. ' +
  '[Learn how to remove this message.](https://github.com/jsalvata/waiver-stamp/blob/main/docs/auto-approval-setup.md#adopter-checklist)';

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
    const warn = i.bumpingAllowed && !i.lockfileHonestyConfigured ? LOCKFILE_WARNING : '';
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
