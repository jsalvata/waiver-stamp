/**
 * Fixture 1 — APPROVE (design §5 row 2 / task-16 outcome 1).
 *
 * A single commit that is a pure, fully-waivered rename: every commit in the PR is
 * `stamped` (spec §17.2 aggregate), G1/G2 both pass (no `.github/**` or manifest touched),
 * and the `waiver-stamp` backstop check is green — so the reviewer posts an APPROVE.
 */
import { ORDERS_RENAMED, RENAME_WAIVER, USAGE_RENAMED, waiverCommitMessage } from './seed.ts';
import type { Fixture } from './types.ts';

export const approveFixture: Fixture = {
  slug: 'approve',
  description: 'a waivered pure rename (all commits stamped) -> reviewer APPROVEs',
  commits: [
    {
      message: waiverCommitMessage(
        'refactor: rename calculateTotal to computeTotal',
        RENAME_WAIVER,
      ),
      files: {
        'e2e-sandbox/src/orders.ts': ORDERS_RENAMED,
        'e2e-sandbox/src/usage.ts': USAGE_RENAMED,
      },
    },
  ],
  expectedCheckConclusion: 'success',
  expectedReview: { kind: 'approve' },
};
