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

Five checks hitting real GitHub, split by token scope: the classic endpoint 403s a non-admin
token (a permission check before the existence check), so the discovery-**success** checks need
an admin token while the resolve seam and the 403 itself are exercised with a non-admin token.

- **Check A1 — resolve seam (non-admin).** `makeResolvePr(octokit)(owner, repo, headSha)` needs
  only `pull-requests: read`. Requires a real open PR's head SHA, supplied via
  `WAIVER_E2E_HEAD_SHA` (in CI: the PR event's `pull_request.head.sha`). Asserts `baseRef` is a
  real ref (does **not** match `/^[0-9a-f]{40}$/`) and `base` **does** match a 40-hex SHA — the
  sha/ref regression the bug needed. `it.skipIf(!WAIVER_E2E_NONADMIN_TOKEN || !WAIVER_E2E_HEAD_SHA)`.
- **Check A2 — full `resolve → discover` chain (admin).** Same resolve, then
  `discoverRequiredChecks(octokit, owner, repo, pr.baseRef)`; when `baseRef === 'main'`, assert
  the result contains `lockfile-assay`. `it.skipIf(!WAIVER_E2E_ADMIN_TOKEN || !WAIVER_E2E_HEAD_SHA)`.
- **Check B — rules endpoint, this repo (admin).** `discoverRequiredChecks(adminOctokit,
  'jsalvata', 'waiver-stamp', 'main')` → `toContain('lockfile-assay')`. Confirms the real read +
  parse independent of a PR context. `it.skipIf(!WAIVER_E2E_ADMIN_TOKEN)`.
- **Check C — classic endpoint, admin-gated.** `discoverRequiredChecks(adminOctokit,
  'mixmaxhq', 'monorepo-experimental', 'main')` → non-empty (its real classic required checks;
  asserting non-emptiness, not exact names, to avoid brittleness against a repo we don't own).
  `it.skipIf(!WAIVER_E2E_ADMIN_TOKEN)`.
- **Check D — the 403 the override fallback exists for (non-admin).**
  `discoverRequiredChecks(nonadminOctokit, 'jsalvata', 'waiver-stamp', 'main')` rejects — the
  classic read 403s a non-admin token before the union can return.
  `it.skipIf(!WAIVER_E2E_NONADMIN_TOKEN)`.

Octokit is built from `@actions/github`'s `getOctokit(token)`. Token resolution:
- `WAIVER_E2E_ADMIN_TOKEN` — a known-admin token (holds `administration: read`) — gates A2, B, C.
- `WAIVER_E2E_NONADMIN_TOKEN` — a known-non-admin token — gates A1, D. In CI: the default
  `github.token`.
- `WAIVER_E2E_HEAD_SHA` — a real open PR's head SHA — gates A1, A2.

The split exists because discovery-success needs admin (the classic endpoint 403s a non-admin
token), while the resolve seam and the 403 itself are exercised with the non-admin token — so
CI (default `github.token`) runs A1 + D on every PR, and the admin-gated checks (A2, B, C) run
locally or once an admin secret exists.

`WAIVER_E2E_ADMIN_TOKEN` is **any** token holding `administration: read` on the classic target —
NOT the reviewer App secrets (those are a per-adopter-repo credential, scoped to a
rulesets-only repo, and don't exist until setup). Locally: `WAIVER_E2E_ADMIN_TOKEN=$(gh auth
token)`. In CI: a dedicated PAT/App secret, added later; until then A2/B/C auto-skip.

### 2. Vitest wiring

- Exclude `*.integration.test.ts` from the default `pnpm test` (unit run stays offline/fast) —
  via `test.exclude` in the vitest config (or an equivalent project split).
- New script `test:integration` that runs **only** the integration suite.

### 3. CI wiring

- A **dedicated CI job** (separate from the unit `build` job so live-API flakiness can't block
  unrelated work) that runs `pnpm test:integration`, passing `WAIVER_E2E_NONADMIN_TOKEN: ${{
  github.token }}` and `WAIVER_E2E_HEAD_SHA: ${{ github.event.pull_request.head.sha }}` on PR
  events — so checks A1 and D run on every PR.
- The admin-gated checks (A2, B, C) stay skipped until a `WAIVER_E2E_ADMIN_TOKEN` secret is
  provided.

## Data flow

```
CI (PR event) ──WAIVER_E2E_NONADMIN_TOKEN=github.token──▶ A1: makeResolvePr(headSha) ─▶ {base:SHA, baseRef:ref}
                                                       └─▶ D: discoverRequiredChecks('main') ─▶ rejects (403)
WAIVER_E2E_ADMIN_TOKEN ─▶ A2: resolve(headSha) → discoverRequiredChecks(baseRef) ─▶ real checks
                       ─▶ B: discoverRequiredChecks('main') ─▶ ['lockfile-assay', …]
                       ─▶ C: discoverRequiredChecks(monorepo-experimental,'main') ─▶ non-empty
```

## Error / flakiness handling

- Live-API calls can transiently fail. The dedicated job isolates that from the unit gate; a red
  integration job flags investigation, not an unrelated-PR block. (If flakiness proves annoying,
  a follow-up can make the job non-required or add a single retry — not designed in now, YAGNI.)
- Assertions are resilient: `toContain` (not exact equality) for our own repo; non-emptiness for
  the third-party classic repo. They reflect **live** config and are updated if we change our own
  required checks.

## Testing (of this test)

The integration suite *is* the test. Its own correctness is verified by running it: checks D
and (with `$(gh auth token)` as `WAIVER_E2E_ADMIN_TOKEN`) B and C locally, and A1/A2 by pushing
a PR (its own PR exercises the resolve→discover chain, base `main`, expecting
`lockfile-assay`).

## Placement

A standalone PR off `main`, before PR 2 — so autodiscovery is guarded before the reusable
workflows stack on it.
