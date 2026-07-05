/**
 * Fixture 3 — invalid, honest failed claim (design §5 row 6 / task-16 outcome 3).
 *
 * A commit embeds the rename waiver but its diff does not match what the waiver claims (the
 * body of `calculateTotal`/`computeTotal` changes too — a smuggled behavioural edit, same
 * shape as `stamp.test.ts`'s "REQUESTS CHANGES when a commit has a waiver but it is invalid"
 * case). Aggregate class is `invalid` -> verdict REQUEST_CHANGES (spec §17.2) -> the
 * `waiver-stamp` producer job (ci.yml) exits 1 on that verdict, so the **check goes red**.
 *
 * Per design §5's decision table, an honest `invalid` is deliberately **not** re-surfaced as
 * a review — "the red `waiver-stamp` check already blocks and explains" (§5 row 6) — so the
 * reviewer must post **no review at all** here. This is the row that most differs from a
 * naive reading of spec §17.2 ("invalid -> request-changes review"): the review channel is
 * reserved for the *trust* layer (a forged APPROVE that G1/G2 refute), not for an honest
 * failed claim the required check already surfaces (design §11 records this refinement).
 */
import { RENAME_WAIVER, USAGE_RENAMED, waiverCommitMessage } from './seed.ts';
import type { Fixture } from './types.ts';

export const invalidFixture: Fixture = {
  slug: 'invalid',
  description:
    'a present-but-failing waiver (smuggled behaviour change) -> red waiver-stamp check, reviewer posts NOTHING',
  commits: [
    {
      message: waiverCommitMessage(
        'refactor: rename calculateTotal to computeTotal',
        RENAME_WAIVER,
      ),
      files: {
        // The waiver claims a pure rename, but the multiplier changed 2 -> 3: the folded
        // emit no longer matches base's emit under the rename, so this stamps `invalid`.
        'e2e-sandbox/src/orders.ts':
          'export function computeTotal(n: number): number {\n  return n * 3;\n}\n',
        'e2e-sandbox/src/usage.ts': USAGE_RENAMED,
      },
    },
  ],
  expectedCheckConclusion: 'failure',
  expectedReview: { kind: 'none' },
};
