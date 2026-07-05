/**
 * Fixture 4 — ABSTAIN (design §5 row 7 / task-16 outcome 4).
 *
 * A single ordinary commit with no ```waiver block at all. Aggregate class is `unwaivered`
 * only -> verdict ABSTAIN (spec §17.2) -> the `waiver-stamp` producer check stays green
 * (ABSTAIN is not REQUEST_CHANGES, ci.yml only fails the job on REQUEST_CHANGES), and the
 * reviewer posts **no review** — "emit nothing" is the explicit downside-bound behaviour for
 * a PR the tool never had an opinion on.
 */
import { USAGE_BASE } from './seed.ts';
import type { Fixture } from './types.ts';

export const abstainFixture: Fixture = {
  slug: 'abstain',
  description: 'no waiver blocks at all -> verdict ABSTAIN, reviewer posts NOTHING',
  commits: [
    {
      message: 'chore: a normal edit with no waiver',
      files: {
        'e2e-sandbox/src/usage.ts': `${USAGE_BASE}export const extra = 1;\n`,
      },
    },
  ],
  expectedCheckConclusion: 'success',
  expectedReview: { kind: 'none' },
};
