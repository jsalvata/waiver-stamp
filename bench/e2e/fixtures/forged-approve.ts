/**
 * Fixture 6 — forged-producer APPROVE → guard-refuted REQUEST_CHANGES review.
 *
 * This is the ONE design-§5 row the honest fixtures cannot reach on their own: "`APPROVE`,
 * G1 fails → REQUEST_CHANGES review — the trusted layer refuted this claim." It fires only when
 * the *artifact* dishonestly claims APPROVE while the reviewer's OWN fresh G1 re-run (over the
 * real base..head, independent of the producer) finds a `.github/**` touch — i.e. a compromised
 * or bypassed producer. An honest `waiver stamp` can never emit APPROVE for an uncovered
 * `.github/**` change (that's what `g1-forgery.ts` documents), so here we simulate the
 * compromised producer directly.
 *
 * Mechanism: the fixture commit OVERWRITES `.github/workflows/ci.yml` with a minimal CI that
 *   (a) keeps a green `build` job — so the reviewer's `ci-checks: build` backstop still passes;
 *   (b) replaces the honest `waiver-stamp` job with one that FORGES a `waiver-stamp-report`
 *       artifact reading `{"verdict":"APPROVE", base:<pr base>, head:<pr head>, …}` and exits 0
 *       (green check, to look legitimate).
 * Overwriting ci.yml *is* the `.github/**` change. The privileged reviewer runs its own
 * default-branch (trusted) G1 over base..head, finds the ci.yml edit → `guardsPass=false` while
 * the artifact says APPROVE → `decideReview` → REQUEST_CHANGES review.
 *
 * The C1 defence is respected on purpose: the forged artifact carries the *real* base/head
 * (from `github.event.pull_request.*.sha`), so the reviewer's SHA cross-check passes and the
 * guard actually runs — rather than the reviewer no-op'ing on a SHA mismatch. That's what makes
 * this a genuine guard-refutation and not just "the forgery was too sloppy to be evaluated".
 *
 * Validated POST-MERGE only (the workflows run from the default branch). This is the live-PR
 * counterpart to the unit coverage in `guards.test.ts` / `decide.test.ts` / `main.test.ts`.
 */
import { ORDERS_RENAMED, RENAME_WAIVER, USAGE_RENAMED, waiverCommitMessage } from './seed.ts';
import type { Fixture } from './types.ts';

// Minimal CI that forges an APPROVE report instead of running the honest stamp. The `\${{ … }}`
// are literal GitHub expressions (escaped so they survive this TS template literal), evaluated by
// Actions at runtime.
const FORGING_CI = `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "build ok"
  waiver-stamp:
    runs-on: ubuntu-latest
    steps:
      - name: forge an APPROVE report (simulated compromised producer)
        shell: bash
        env:
          BASE: \${{ github.event.pull_request.base.sha }}
          HEAD: \${{ github.event.pull_request.head.sha }}
        run: |
          printf '{"verdict":"APPROVE","base":"%s","head":"%s","toolVersion":"forged","commits":[]}' "$BASE" "$HEAD" > waiver-stamp-report.json
      - uses: actions/upload-artifact@v4
        with:
          name: waiver-stamp-report
          path: waiver-stamp-report.json
`;

export const forgedApproveFixture: Fixture = {
  slug: 'forged-approve',
  description:
    "a compromised producer forges an APPROVE artifact for a range touching .github/** -> the reviewer's own G1 re-run refutes it -> REQUEST_CHANGES review",
  commits: [
    {
      message: waiverCommitMessage(
        'refactor: rename calculateTotal to computeTotal',
        RENAME_WAIVER,
      ),
      files: {
        'e2e-sandbox/src/orders.ts': ORDERS_RENAMED,
        'e2e-sandbox/src/usage.ts': USAGE_RENAMED,
        // Overwriting ci.yml is the .github/** change G1 catches; it also forges the APPROVE artifact.
        '.github/workflows/ci.yml': FORGING_CI,
      },
    },
  ],
  // The forging producer exits 0 to look legitimate — its `waiver-stamp` check is green...
  expectedCheckConclusion: 'success',
  // ...but the reviewer's independent G1 refutes the APPROVE claim with a REQUEST_CHANGES review.
  expectedReview: { kind: 'requestChanges' },
};
