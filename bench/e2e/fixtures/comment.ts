/**
 * Fixture 2 — COMMENT (design §5 row 4 / task-16 outcome 2).
 *
 * Two commits: one fully-waivered stamped rename, then one ordinary unwaivered commit.
 * Aggregate class is `stamped` + `unwaivered` with zero `invalid` -> verdict COMMENT
 * (spec §17.2); G1/G2 pass and the backstop is green -> reviewer posts a COMMENT review
 * (the vouched-subset note), never an APPROVE.
 */
import { ORDERS_RENAMED, RENAME_WAIVER, USAGE_RENAMED, waiverCommitMessage } from './seed.ts';
import type { Fixture } from './types.ts';

export const commentFixture: Fixture = {
  slug: 'comment',
  description:
    'one stamped commit + one unwaivered commit (mixed, no invalid) -> reviewer COMMENTs',
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
    {
      message: 'chore: add an unwaivered line',
      files: {
        'e2e-sandbox/src/usage.ts': `${USAGE_RENAMED}export const extra = 1;\n`,
      },
    },
  ],
  expectedCheckConclusion: 'success',
  expectedReview: { kind: 'comment' },
};
