# Real-PR e2e acceptance harness

[Spec](../../docs/spec.md) §17.2/§18.3, [design](../../docs/automation-layer.md) §5/§10
(task-16). A `gh`-driven acceptance harness that opens real PRs against a sandbox branch of
this repo and asserts the `waiver-stamp-review` action posts exactly the outcome each fixture
is designed to produce.

## This is a POST-MERGE acceptance step

> **Maintainer note (revisit after the first live run).** This section is written for the
> pre-merge state, when the harness has never executed against live GitHub Actions. Once it
> *has* — i.e. once the automation is on `main` and a real run has passed — rewrite this
> section into a durable *warning*: keep the "always execute the default-branch workflow
> definition" caveat (it stays true and bites anyone testing workflow changes from a branch),
> but drop the "has never been run / do not fake a passing run" framing, which will be stale.

`bench/e2e/run.ts` is committed now, but **cannot be run until this whole automation-layer
feature (PRs 1–3, task-16 included) has been merged to `main`.** This is not a limitation of
the harness — it is how GitHub Actions works:

- `pull_request` and `workflow_run` triggers always execute the **workflow definition that
  lives on the repository's default branch**, never a definition from the triggering PR's own
  branch.
- Right now, `.github/workflows/waiver-stamp-review.yml` and the `waiver-stamp` job in
  `.github/workflows/ci.yml` exist only on this feature branch. Opening a PR against a
  sandbox base today would run whatever `waiver-stamp-review.yml` (if anything) currently
  lives on `main` — not the one this branch adds.
- Only after this feature merges to `main` does the deployed `waiver-stamp-review` workflow
  exist to react to real PRs, and only then does running this harness actually exercise it.

So: this file is correct-by-construction and reviewable now, but its first real run happens
after merge, as the final acceptance check that the deployed automation behaves exactly like
the unit tests (Tasks 1–9) and the design (`docs/automation-layer.md`) say it should.

**Do not fake a "passing" run.** Nobody has executed `run.ts` against live GitHub Actions as
of this commit — it has only been typechecked and, in this sandbox (`gh` absent), invoked far
enough to prove it parses, loads, and fails loudly on a missing prerequisite rather than
silently no-opping.

## How to run it (post-merge)

Prerequisites:

- [GitHub CLI](https://cli.github.com/) (`gh`), authenticated (`gh auth login`) against an
  account with push access to `jsalvata/waiver-stamp` and permission to open PRs there.
- `git` on `PATH`.
- Run from a clean checkout with network access; the harness clones nothing local — it
  creates its own scratch clone in a temp directory and pushes branches to `origin` over
  `https://github.com/jsalvata/waiver-stamp.git`.

```bash
tsx bench/e2e/run.ts
```

The script:

1. Ensures a sandbox base branch (`e2e-sandbox-base`) exists on the remote, branched from the
   repo's default branch and seeded with a tiny loadable TypeScript project
   (`bench/e2e/fixtures/seed.ts`) so a `rename` waiver has something real to fold over.
2. For each fixture in `bench/e2e/fixtures/` (in order: `approve`, `comment`, `invalid`,
   `abstain`, `g1-forgery`, `forged-approve`): creates a uniquely-named branch off the sandbox base, applies the
   fixture's commits (each may embed a fenced ` ```waiver ` block per spec §17.1), pushes, and
   opens a real PR via `gh pr create`.
3. Polls `gh pr checks` until the `waiver-stamp` producer check (the `waiver-stamp` job in
   `ci.yml`) reaches a terminal conclusion, and asserts it matches the fixture's expectation.
4. Polls `gh run list --workflow waiver-stamp-review` until a run whose `headSha` matches the
   PR's head SHA completes, then reads `gh pr view --json reviews` and asserts the latest
   non-dismissed review state matches the fixture's expectation.
5. Reports PASS/FAIL per fixture and exits non-zero if any fixture's observed outcome
   mismatches its expectation — a broken assertion fails loudly, it does not get silently
   skipped.

Every fixture's PR and branch are left open (pass or fail) for inspection. Clean up manually
once you're done reviewing a run:

```bash
# List this run's PRs (branch names are e2e/<slug>-<runId>):
gh pr list --repo jsalvata/waiver-stamp --search "head:e2e/" --state open

# Close + delete one:
gh pr close <number> --repo jsalvata/waiver-stamp --delete-branch
```

The sandbox base branch (`e2e-sandbox-base`) is meant to be long-lived — reused across runs,
not deleted between them.

## The five fixtures and their expected outcomes

Per design §5's reviewer decision table (`docs/automation-layer.md` §5) and spec §17.2's
verdict aggregation, realized against an **honest** producer (this repo's own, untampered
`waiver-stamp` CI job — nothing in this harness forges an artifact or bypasses the engine):

| # | Fixture (`fixtures/*.ts`) | What it commits | `waiver-stamp` check | Reviewer posts |
|---|---|---|---|---|
| 1 | `approve` | one commit: a fully-waivered pure rename | success (verdict APPROVE) | **APPROVE** |
| 2 | `comment` | one stamped commit + one plain unwaivered commit | success (verdict COMMENT) | **COMMENT** |
| 3 | `invalid` | one commit whose waiver claims a pure rename but the diff also changes behaviour (a smuggled edit) | **failure** (verdict REQUEST_CHANGES) | **NOTHING** |
| 4 | `abstain` | one plain commit, no `waiver` block at all | success (verdict ABSTAIN) | **NOTHING** |
| 5 | `g1-forgery` | one commit: a stamped rename plus an edit under `.github/**`, still claiming only the rename | **failure** (verdict REQUEST_CHANGES) | **NOTHING** |
| 6 | `forged-approve` | one commit: a stamped rename plus a `.github/workflows/ci.yml` overwrite that forges an APPROVE artifact (simulated compromised producer) | success (forged green) | **REQUEST_CHANGES** |

Fixtures 3 and 5 both land on "check goes red, reviewer posts nothing" — see the note below on
why fixture 5 does **not** exercise the review-level G1 path, and why that's fine.

### Why "invalid" and "g1-forgery" are both silent, not `REQUEST_CHANGES` reviews

A literal reading of spec §17.2's per-commit table ("`invalid` -> REQUEST_CHANGES") might
suggest the bot should post a REQUEST_CHANGES *review* whenever the aggregate verdict is
REQUEST_CHANGES. Design §5 deliberately refines this: because `waiver stamp` runs as a
**required check** in CI, an honest REQUEST_CHANGES verdict already blocks the merge and
explains itself in the job summary — so "the review channel is reserved for the trust layer"
(design §5, "Decisions & rejected alternatives" §11). Concretely (`src/action/decide.ts`):

- `verdict === 'REQUEST_CHANGES'` (or `ABSTAIN`) -> the reviewer's `decideReview` returns
  `{ action: 'NONE' }` unconditionally, regardless of G1/G2/backstop. **Fixtures 3 and 4** hit
  this branch directly.
- The review-posting **REQUEST_CHANGES** action only fires for a different situation: the
  artifact's verdict claims `APPROVE`, but the reviewer's own independent G1/G2 re-run (over
  the real base/head trees, not trusting the producer's claim) finds a `.github/**` touch or
  an out-of-envelope manifest change anyway — i.e. the artifact is lying or the producer was
  bypassed. That is "the trusted layer refuted this APPROVE claim."

**Fixture 5 (`g1-forgery`) cannot reach that second path with an honest producer**, and that is
the point being demonstrated, not a gap: this repo's own `waiver stamp` engine already treats a
`.github/**` file that no op in the waiver accounts for as **uncovered** (spec §3.1.5 coverage),
so the commit classifies `invalid` before G1 ever gets a chance to run in the reviewer. The
aggregate verdict is REQUEST_CHANGES, the check goes red, and the reviewer's `decideReview`
short-circuits to `NONE` on the `verdict === 'REQUEST_CHANGES'` branch — identical mechanism to
fixture 3, just triggered by a different uncovered file.

The **guard-refuted REQUEST_CHANGES review** path — an artifact that dishonestly claims
`APPROVE` while a fresh G1/G2 re-run fails — requires a producer whose engine-level coverage
check has been bypassed or forged. An honest producer can't reach it, so **fixture 6
(`forged-approve`) simulates a compromised producer** to cover it e2e: its commit overwrites
`.github/workflows/ci.yml` with a minimal CI that keeps a green `build` job but replaces the
honest `waiver-stamp` job with one that *forges* an APPROVE `waiver-stamp-report` (carrying the
real base/head SHAs, so the C1 cross-check passes). Overwriting ci.yml is the `.github/**` change
the reviewer's own trusted G1 catches → `guardsPass=false` while the artifact claims APPROVE → a
genuine REQUEST_CHANGES review on a live PR. It is *also* covered by fast, deterministic unit
tests that mock the artifact directly instead of standing up a forging workflow:

- `src/action/guards.test.ts` — `g1WorkflowIntegrity` itself (Task 4), including the
  change-and-revert case.
- `src/action/decide.test.ts` — `decideReview`'s guards-fail branch mapping `APPROVE` +
  `guardsPass: false` to `REQUEST_CHANGES` (Task 7).
- `src/action/main.test.ts` — the orchestrator wiring a failing G1/G2 into that outcome and
  posting it (Task 9).

Between the six e2e fixtures here and those three unit-test files, every reachable
`(verdict, guards, backstop)` combination in design §5's table is exercised somewhere.

## Validation performed on this harness

- `bench/e2e/run.ts`, `bench/e2e/errors.ts`, and every file under `bench/e2e/fixtures/`
  typecheck cleanly against this repo's own strict compiler flags (`tsconfig.json`'s
  `compilerOptions`, run standalone per file since `bench/` is intentionally outside
  `tsconfig.json`'s `include` — it is a script, not published/shipped source).
- `pnpm lint` (Biome) passes on `bench/e2e/`.
- `pnpm exec tsx bench/e2e/run.ts` was invoked once, in a sandbox with no `gh` binary
  installed: it parsed and loaded correctly, ran through local-only setup (temp dir, `git
  init`, `git remote add`, `git config`), reached the first command that needs `gh`, and
  failed loudly with a clear error — no network calls, no mutation of the real repository,
  and the temp directory was cleaned up by the `finally` block. This is as far as this harness
  can be exercised before merge.
- It has **not** been run against live GitHub Actions. That only becomes possible once this
  feature is on `main` (see above) — that first live run is the actual acceptance test this
  harness exists to be.
