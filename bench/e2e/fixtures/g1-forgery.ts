/**
 * Fixture 5 — G1 forgery, honest producer (design §5 / §10, task-16 outcome 5).
 *
 * A commit that is a stamped rename PLUS an edit under `.github/**`, still claiming (and
 * only listing an op for) the rename. This is the fixture the brief calls out as never
 * producing an APPROVE — but with an **honest** `waiver stamp` producer (this repo's own
 * CI, which nobody here is tampering with) the `.github/**` file is simply not covered by
 * any op in the waiver, so §3.1.5 coverage already fails at the ENGINE level: the commit
 * classifies `invalid` (uncovered file), aggregate verdict is REQUEST_CHANGES, the
 * `waiver-stamp` check goes red, and — same as the `invalid` fixture — the reviewer posts
 * NOTHING (design §5 row 6: the red required check already blocks and explains).
 *
 * IMPORTANT — what this fixture does NOT exercise. Design §5's actual G1-triggered row
 * ("`APPROVE`, G1 or G2 fails -> REQUEST_CHANGES review, the trusted layer refuted this
 * claim") only fires when the *artifact* dishonestly claims APPROVE while the reviewer's
 * own fresh G1 re-run (over the real base/head trees, independent of the producer) finds a
 * `.github/**` touch anyway — i.e. a compromised/forged producer, or a producer whose
 * engine-level coverage check was bypassed. An honest producer's `waiver stamp` can't be
 * made to emit APPROVE for an uncovered `.github/**` file, so that path cannot be produced
 * by opening a real PR here. It is exercised by the UNIT tests instead: Task 4
 * (`g1WorkflowIntegrity` itself), Task 7 (`decideReview`'s guards-fail branch), and Task 9
 * (`main.ts` orchestration wiring G1 into the outcome) — see `src/action/guards.test.ts`,
 * `src/action/decide.test.ts`, `src/action/main.test.ts`. This e2e fixture instead documents
 * and asserts the outcome an honest producer actually yields: no APPROVE, full stop.
 */
import { ORDERS_RENAMED, RENAME_WAIVER, USAGE_RENAMED, waiverCommitMessage } from './seed.ts';
import type { Fixture } from './types.ts';

export const g1ForgeryFixture: Fixture = {
  slug: 'g1-forgery',
  description:
    'a stamped rename + a .github/** edit in the same commit -> uncovered file, invalid, red check, reviewer posts NOTHING (never APPROVE)',
  commits: [
    {
      message: waiverCommitMessage(
        'refactor: rename calculateTotal to computeTotal',
        RENAME_WAIVER,
      ),
      files: {
        'e2e-sandbox/src/orders.ts': ORDERS_RENAMED,
        'e2e-sandbox/src/usage.ts': USAGE_RENAMED,
        // Uncovered by any op in RENAME_WAIVER -> coverage fails -> invalid (§3.1.5).
        // A comment-only touch to a harmless workflow file is enough; content doesn't matter.
        '.github/workflows/e2e-forgery-marker.yml':
          '# e2e-forgery fixture marker; not a real workflow (no `on:`/`jobs:` needed for the assertion)\n',
      },
    },
  ],
  expectedCheckConclusion: 'failure',
  expectedReview: { kind: 'none' },
};
