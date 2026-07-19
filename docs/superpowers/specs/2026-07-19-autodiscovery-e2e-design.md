# Autodiscovery end-to-end test — design

> Status: approved (brainstormed 2026-07-19). Feeds an implementation plan.

## Motivation

Check autodiscovery (reviewer reads required checks from the base branch's protection, spec
§2.4) shipped in PR 1. A production-breaking bug slipped through: the reviewer resolved the PR
base as `pr.base.sha` (a SHA) and fed it to the protection endpoints, which key on a **branch
name** — so discovery silently returned `[]`. It was caught only in review. Neither the mocked
unit tests nor a direct `discoverRequiredChecks(…, 'main')` smoke test caught it: the mocks
don't reflect real GitHub, and the smoke test bypassed the `pr.base` resolve seam by passing a
branch name directly. The gap is a **live-API test that exercises the real resolve → discover
chain**.

## Scope

**Layered, per the brainstorm:**

- **Now (this design):** a live-API *discovery* integration test — no deployed workflow. Guards
  the resolve→discover path and both protection mechanisms against real GitHub.
- **Later (PR 2):** the full `workflow_run` + posted-review acceptance harness (automation-layer
  §10) rides in when the reusable reviewer is deployed and dogfooded.

Out of scope: a dedicated sandbox repo (rejected — the real blocker for the classic path is the
admin token, not a missing check; and adding classic protection to this repo risks the
semantic-release `[skip ci]` push).

No prep/cleanup refactor needed — this is self-contained new test code plus CI wiring.

## Components

A new integration suite, isolated from the offline unit tests.

### 1. `src/action/discover-checks.integration.test.ts` (new)

Three checks, each hitting real GitHub:

- **Check A — full `resolve → discover` chain (the regression the bug needed).** Requires a real
  open PR's head SHA, supplied via `WAIVER_E2E_HEAD_SHA` (in CI: the PR event's
  `pull_request.head.sha`). `makeResolvePr(octokit)(owner, repo, headSha)` → assert `baseRef`
  is a real ref (does **not** match `/^[0-9a-f]{40}$/`) and `base` **does** match a 40-hex SHA;
  then `discoverRequiredChecks(octokit, owner, repo, baseRef)` and, when `baseRef === 'main'`,
  assert the result contains `lockfile-assay`. Feeding a SHA to the endpoint (the original bug)
  makes this fail. `it.skipIf(!process.env.WAIVER_E2E_HEAD_SHA)`.
- **Check B — rules endpoint, this repo.** `discoverRequiredChecks(octokit, 'jsalvata',
  'waiver-stamp', 'main')` → `toContain('lockfile-assay')`. Runs whenever the suite runs (the
  repo is public — the rules endpoint is readable even unauthenticated). Confirms the real read
  + parse independent of a PR context.
- **Check C — classic endpoint, admin-gated.** With an admin token,
  `discoverRequiredChecks(adminOctokit, 'mixmaxhq', 'monorepo-experimental', 'main')` →
  non-empty (its real classic required checks; asserting non-emptiness, not exact names, to
  avoid brittleness against a repo we don't own). `it.skipIf(!process.env.WAIVER_E2E_ADMIN_TOKEN)`.

Octokit is built from `@actions/github`'s `getOctokit(token)`. Token resolution:
- Checks A/B: `process.env.GITHUB_TOKEN` if present, else an unauthenticated Octokit (public
  rules endpoint).
- Check C: `getOctokit(process.env.WAIVER_E2E_ADMIN_TOKEN)`.

`WAIVER_E2E_ADMIN_TOKEN` is **any** token holding `administration: read` on the classic target —
NOT the reviewer App secrets (those are a per-adopter-repo credential, scoped to a
rulesets-only repo, and don't exist until setup). Locally: `WAIVER_E2E_ADMIN_TOKEN=$(gh auth
token)`. In CI: a dedicated PAT/App secret, added later; until then check C auto-skips.

### 2. Vitest wiring

- Exclude `*.integration.test.ts` from the default `pnpm test` (unit run stays offline/fast) —
  via `test.exclude` in the vitest config (or an equivalent project split).
- New script `test:integration` that runs **only** the integration suite.

### 3. CI wiring

- A **dedicated CI job** (separate from the unit `build` job so live-API flakiness can't block
  unrelated work) that runs `pnpm test:integration`, passing
  `WAIVER_E2E_HEAD_SHA: ${{ github.event.pull_request.head.sha }}` on PR events so check A runs.
- The job needs no extra secret for A/B (default `GITHUB_TOKEN`). Check C stays skipped until a
  `WAIVER_E2E_ADMIN_TOKEN` secret is provided.

## Data flow

```
CI (PR event) ──WAIVER_E2E_HEAD_SHA──▶ Check A: makeResolvePr(headSha) ─▶ {base:SHA, baseRef:ref}
                                                     └─▶ discoverRequiredChecks(baseRef) ─▶ real checks
default GITHUB_TOKEN ─▶ Check B: discoverRequiredChecks('main') ─▶ ['lockfile-assay', …]
WAIVER_E2E_ADMIN_TOKEN ─▶ Check C: discoverRequiredChecks(monorepo-experimental,'main') ─▶ non-empty
```

## Error / flakiness handling

- Live-API calls can transiently fail. The dedicated job isolates that from the unit gate; a red
  integration job flags investigation, not an unrelated-PR block. (If flakiness proves annoying,
  a follow-up can make the job non-required or add a single retry — not designed in now, YAGNI.)
- Assertions are resilient: `toContain` (not exact equality) for our own repo; non-emptiness for
  the third-party classic repo. They reflect **live** config and are updated if we change our own
  required checks.

## Testing (of this test)

The integration suite *is* the test. Its own correctness is verified by running it: check B and
(with `$(gh auth token)`) check C locally, and check A by pushing a PR (its own PR exercises A,
base `main`, expecting `lockfile-assay`).

## Placement

A standalone PR off `main`, before PR 2 — so autodiscovery is guarded before the reusable
workflows stack on it.
