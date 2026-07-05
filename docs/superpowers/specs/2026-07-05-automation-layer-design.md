# waiver-stamp Automation Layer — Design (§18.3)

> **Status:** design (approved for planning) · **Date:** 2026-07-05
> **Implements:** spec `docs/spec.md` §18.3 (automation layer), consuming §17.2/§17.3
> (verdict + report), gated by §3.1.6 / §14.4 (backstop) and §6.3.5 (lockfile honesty).
> **Scope:** the reusable GitHub asset that turns a `waiver stamp` verdict into a real
> GitHub review, its trust boundary, the third-party adoption story, and dogfooding it in
> this repo. The core engine (`waiver stamp --json`) is already built; this is the seam
> around it.

---

## 1. Purpose

`waiver stamp --json` already emits the authoritative verdict (`APPROVE` / `COMMENT` /
`REQUEST_CHANGES` / `ABSTAIN`) and per-commit report (§17.2/§17.3). What is missing is the
**automation layer**: the CI/CD wiring that runs the stamp on the exact head a PR will
merge, confirms the backstop is green on that same SHA, and posts the mapped GitHub
review — so a fully-stamped refactor PR is auto-approved and a human never reads the
mechanical part (§16, §20).

Two deliverables, one effort:

1. **Reusable assets, tools, and docs** so *any* repo can adopt this — the primary goal.
2. **Dogfood** the exact same assets in the waiver-stamp repo itself, as the reference
   installation and the end-to-end test bed.

**Non-negotiable invariant (inherited from §1, §17.2).** The layer is **downside-bounded**:
the *only* verdict that removes human review is `APPROVE`, and an `APPROVE` is posted only
when every guard and every required check passes on the exact head SHA. Every failure,
ambiguity, timeout, or API error is **fail-closed** — it yields no review or a neutral
note, never a fabricated verdict. Worst case = today's normal review.

---

## 2. Architecture — a two-layer split

The layer is split across the **trust boundary** GitHub gives us, not bundled into one
job. This is the load-bearing decision (security rationale in §3).

```
 PR push
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ UNPRIVILEGED — runs in the PR's context (read-only token on  │
│ forks). Part of normal CI, on `pull_request`.                │
│                                                              │
│   stamp-check action:                                        │
│     waiver stamp --base <PR base> --head <PR head> --json    │
│     → job summary (instant per-push feedback)                │
│     → upload report as an artifact (the interface contract)  │
│     → set check conclusion (fail iff REQUEST_CHANGES)        │
└─────────────────────────────────────────────────────────────┘
   │  (workflow completes)
   ▼
┌─────────────────────────────────────────────────────────────┐
│ PRIVILEGED — runs from the DEFAULT BRANCH definition, base   │
│ repo context, write token. Trigger: `workflow_run`.          │
│                                                              │
│   stamp-review action:                                       │
│     resolve PR + head_sha from the event                     │
│     download the report artifact BY RUN ID; zod-validate     │
│     G1: no commit touches .github/**                         │
│     G2: manifest/lockfile changes within the §6.3 envelope   │
│     confirm every `required-checks` == success on head_sha   │
│     map verdict → GitHub review (decision table §5)          │
└─────────────────────────────────────────────────────────────┘
```

- **The unprivileged half computes the verdict** as an ordinary CI check. It reuses the
  build job's already-installed dependencies, so `waiver stamp` emits with the repo's own
  TypeScript (§9) at no extra cost. Its check becomes a **named required status** the repo
  can gate merges on.
- **The privileged half only submits a review.** It never runs the repo's toolchain, so
  the write token never sits next to attacker-influenceable code execution. It trusts the
  unprivileged artifact **only after** two guards (§3) independently re-establish, from git
  data alone, that the artifact could not have been forged.

The two halves communicate through **one artifact** (`waiver-stamp-report`, schema in §4.3)
scoped to the triggering run — the only coupling between them.

---

## 3. Trust boundary & security model (the crux)

The reviewer's write token is the credential that *removes human review*. Its integrity is
the whole system's integrity, so the threat model is explicit.

### 3.1 The threat

A `pull_request` workflow **runs the PR author's version of the workflow file** and
executes the PR's toolchain (`pnpm install` lifecycle scripts; `waiver stamp` loading the
repo's TypeScript; the `lint-fix` op running the repo's linter, §6.1). Therefore, taken
alone:

- the **check conclusion is forgeable** — a PR can rewrite CI to `exit 0` a job named
  `waiver-stamp`, minting a green check of any name;
- the **report artifact is forgeable** — a PR can upload a handcrafted
  `{"verdict":"APPROVE"}`, or have code running *inside* an honest stamp process overwrite
  the report before upload.

Neither the artifact nor the check color is, by itself, evidence of anything. This is the
classic "pwn request" boundary, sharpened because waiver-stamp is *designed* to run the
repo's toolchain.

### 3.2 The two guards (de-circularizing trust)

The saving fact: a **`workflow_run` workflow always runs the definition from the default
branch.** The reviewer's own code, its `required-checks` config, and its orchestration are
tamper-proof from a PR. On top of that fixed point, the reviewer re-establishes trust using
**only git file data — no untrusted code ever executes in the privileged context:**

- **G1 — workflow integrity.** No commit in `base..head` touches `.github/**` (checked
  **per-commit** via `git log --name-only`, not the net diff — a change-and-revert nets to
  zero but still poisons the intermediate trees the stamp folded through). Any hit → the
  workflow the stamp ran under, and the job graph that produced the checks, are not the
  reviewed ones → **never APPROVE**. Kills both the workflow-edit and check-name-minting
  forgeries.
- **G2 — manifest envelope.** If any commit touches `package.json` / the lockfile, the
  reviewer **independently re-runs §6.3 gates 1–4** over the range (reusing the engine's
  own `deps.ts` gates, reading both manifests and base's `.waiver-stamp.json` via
  `git show` — pure data, no execution). The bump must be confined, allowlisted,
  plain-semver, and up-moving, exactly as an honest engine-level APPROVE required. Out of
  envelope → the artifact's APPROVE could not have been honestly computed → **never
  APPROVE**.

**Why the guards suffice.** With G1 clean, the workflow files are the reviewed ones. With
G2 clean, the toolchain that executed during stamp is base's (already default-branch
reviewed) — head *source* is only *emitted* by `waiver stamp` (ts-morph/tsc emit does not
run user code), never executed. A malicious `tsconfig` transformer can't ride along either:
`tsconfig` is a non-excludable byte-compared file (§7), so any change makes the stamp
itself not-APPROVE. Once G1+G2 pass, the artifact is exactly as trustworthy as the honest
run that produced it.

**Trust invariant that powers §5:** *an honestly-computed APPROVE implies G1 and G2 pass.*
A stamped commit cannot touch `.github/**` (yaml is uncovered by every op — the
`change-docs` extension floor and the `change-test` backstop-integrity exclusion both
refuse it), and a manifest-touching commit only stamps if the engine already ran gates
1–4. So **guards-fail + artifact-says-APPROVE ⇒ the artifact was not honestly computed** —
a forgery, a bypass attempt, or engine-version skew between the two halves. That is the one
case worth actively flagging.

### 3.3 The honest-lockfile boundary (stated precisely)

Per the approved decision, the layer **assumes the lockfile is honest** (there is no
lockfile-honesty tool wired in yet; the firewall is a separate, not-yet-integrated
product).

- **Default config (`allowBumping` absent/empty):** G2 reduces to "no manifest/lockfile
  change at all," so the toolchain-trust chain is **closed** — no honesty check is needed
  for the APPROVE path to be sound.
- **With `allowBumping` set and no honesty check:** a lockfile entry for an allowlisted
  package that keeps the version string but points at a poisoned tarball passes gates 1–4,
  executes during the stamp install, and could forge the report. This is §6.3.5's warning,
  extended to the automation layer — the **accepted residual** the APPROVE warning banner
  covers (§5, §7).

### 3.4 Other surfaces & mitigations

- **Artifact poisoning by a same-named artifact from another run** → download strictly by
  the **triggering run's ID** from the event payload, never "latest named X"; zod-validate
  before use; cross-check the artifact's recorded `head` equals the event `head_sha`.
- **Markdown / prompt injection** — commit subjects and waiver content flow into review
  bodies; a subject can fake an "✅ approved" banner or carry prompt-injection aimed at
  other LLM agents reading the PR. Decision-relevant text is rendered from
  **reviewer-computed facts**; anything sourced from the PR is escaped, inside a fence, with
  explicit provenance.
- **TOCTOU / races** — everything binds to the triggering run's `head_sha`; the review sets
  `commit_id`; the reviewer re-checks the live PR head immediately before submit and aborts
  if it moved (a fresh cycle is already coming). Stale approvals are cleared by GitHub's
  native *"dismiss stale approvals when new commits are pushed"* branch-protection toggle
  (documented as a required setting), not reimplemented.
- **Reviewer hygiene** — minimal `permissions:` (`pull-requests: write`; `checks`,
  `contents`, `actions: read`), `persist-credentials: false`, SHA-pinned third-party
  actions, dependency-light bundle. `zizmor` + `actionlint` run on our own workflows in CI.
- **Fork edges** — first-time-contributor workflow-approval gates mean no run / no artifact
  → reviewer no-ops. Every guard failure, missing check, or API error is fail-closed.
- **Our own supply chain** — a consumer's reviewer runs **our** code with **their** write
  token. Adoption docs mandate full-SHA pinning of the action ref. This repo auto-publishes
  to npm on merge to `main`, so our own dogfood (approve → auto-merge → release) is itself a
  supply-chain-sensitive target; a human stays on the merge button for non-stamped PRs.

---

## 4. Components

### 4.1 `stamp-check` — unprivileged CI action (composite)

`/.github/actions/stamp-check/action.yml`. A thin composite step a consumer appends to
their existing build job (after `install`), or runs as a small dedicated job on
`pull_request`.

- **Inputs:** `waiver-version` (which `waiver-stamp` to run; default a pinned version).
- **Behaviour:** resolve `base = event.pull_request.base.sha`,
  `head = event.pull_request.head.sha`; run `waiver stamp --base --head --json`; write the
  verdict + per-commit findings to the **job summary**; upload the report (plus the `base`
  and `head` SHAs it used) as the `waiver-stamp-report` artifact; set the job **conclusion**
  = failure iff verdict is `REQUEST_CHANGES` (an honest failed claim blocks the merge right
  where the author iterates), else success/neutral.
- **The artifact uploads regardless of conclusion** (`if: always()`, before the failing
  exit) so the reviewer can distinguish an honest `invalid` (artifact present, verdict
  `REQUEST_CHANGES`) from a missing artifact (fail-closed neutral). Conclusion and artifact
  are independent signals.
- Needs only the read token forks get. Requires `fetch-depth: 0` checkout (stamp walks the
  commit range).

### 4.2 `stamp-review` — privileged reviewer action (JavaScript)

`/.github/actions/stamp-review/`. A **JavaScript action** (TypeScript source under
`src/action/`, bundled to a committed `dist/index.js`), chosen so it reuses `report.ts`
types and `deps.ts` gates directly — the verdict mapping and the G2 re-run cannot drift
from the engine, and it is unit-testable with vitest against a mocked Octokit.

- **Trigger (consumer's caller):** `workflow_run: { workflows: [<producer workflows>],
  types: [completed] }`.
- **Inputs:** `required-checks` (newline/comma list of check-run names that must be
  `success` on the head SHA; **default empty**); `github-token` (default `${{ github.token
  }}`; a repo passes an App / bot-PAT token to make APPROVE count toward branch
  protection).
- **Behaviour:** resolve the PR + `head_sha` from the `workflow_run` event (no-op if no open
  PR); **independently derive** `base` and cross-check the artifact's SHAs (mismatch →
  neutral no-op); download + zod-validate the run-scoped artifact; run **G1** and **G2**;
  confirm every `required-checks` entry is `success` on `head_sha`; map the verdict to a
  review per §5; manage the sticky comment; dismiss its own stale reviews (§6).
- **Dependencies:** `@actions/core`, `@actions/github`, `zod` (artifact validation),
  `semver` (via the reused `deps.ts` gates). Bundle kept in sync by a CI drift-guard that
  rebuilds and diffs `dist/` (mirrors the existing schema drift-guard).

### 4.3 The artifact contract (`waiver-stamp-report`)

The single interface between the halves. A JSON document: the §17.3 `VerifyReport`
(`verdict` + per-commit results) plus `{ base, head }` (the SHAs the stamp used) and
`{ toolVersion }` (for engine-skew diagnostics). zod-validated by the reviewer before any
use; the reviewer trusts none of its SHAs without cross-checking against the event.

### 4.4 Workflows & config in this repo (dogfood)

- Add the `stamp-check` step to this repo's CI (a step in the build job or a dedicated
  `pull_request` job producing the artifact + `waiver-stamp` check).
- `/.github/workflows/waiver-stamp-review.yml` — the reviewer caller
  (`workflow_run` on our CI, `required-checks: [<our CI check>]`, `github.token`).
- `/.waiver-stamp.json` at the repo root — a real config (`allowBumping`, `changeDocs`) so
  the repo *is* a working example.

---

## 5. The reviewer decision table

The verdict → output mapping, realized on the two-layer mechanics. Because
`waiver stamp` runs as a **required check**, an honest `invalid` already blocks the merge
and explains itself in the job summary; the **review channel is reserved for the trust
layer**. (This is a deliberate, recorded refinement of §17.2's literal "invalid →
request-changes review" — see §11.)

| Situation | Reviewer output |
|---|---|
| Artifact `APPROVE`, G1+G2 pass, all `required-checks` green | **APPROVE** review (+ conditional lockfile warning, §7) |
| Artifact `COMMENT`, G1+G2 pass, checks green | **COMMENT** review — the vouched-subset note |
| Artifact `REQUEST_CHANGES` (honest invalid) | **Nothing** — the red `waiver-stamp` check blocks and explains |
| Artifact `ABSTAIN` | **Nothing** (§17.2 downside-bound) |
| Any `required-checks` entry not yet green | **No-op** — a later `workflow_run` completion wakes us |
| **G1 or G2 fails while the artifact claims `APPROVE`** | **REQUEST_CHANGES** review — "the trusted layer refuted this claim"; **no artifact content echoed** |
| G1 or G2 fails while the artifact claims anything else | **Neutral one-line comment** — "stamp results for this PR can't be trusted (workflow/manifest changes); full human review applies" (kills the social-engineering variant where a forged COMMENT steers reviewers away from specific commits) |
| Artifact missing / malformed / check-green-but-verdict-red, or any API error | **Quiet fail-closed** — no review, neutral note |

**Self-healing.** On each cycle the reviewer **dismisses its own prior REQUEST_CHANGES** if
the new head's guards pass — an attack flag must not permanently brick a PR that has since
been fixed honestly. Dismissed reviews remain in the timeline as the audit trail.

**Residual, accepted:** in a repo with **no branch protection**, an honest `invalid`
produces only a red check (no PR-conversation review). Still downside-bounded (the PR falls
to whatever review that repo does today); adoption docs list "mark the stamp check
required" as a prerequisite regardless.

---

## 6. Review lifecycle & idempotency

- **Fast feedback, no stale approval.** The `stamp-check` **job summary** shows the current
  verdict on every push, natively, with no token. A prior APPROVE is cleared by GitHub's
  native stale-dismissal on push. The reviewer re-evaluates on the new SHA and only ever
  approves once that SHA's checks are green.
- **Approval gated on green.** The reviewer submits an APPROVE only on a `workflow_run`
  completion where the full `required-checks` set is green — the last required workflow to
  finish is the wake-up on which the set is finally green. No polling, no waiting.
- **Idempotency.** A `concurrency` group keyed on the PR serializes review mutations; the
  reviewer maintains a **single** sticky comment (rewritten, not stacked) and a single
  active review, so simultaneous wake-ups collapse to one outcome.

---

## 7. Configuration surface

- **`required-checks`** (reviewer input, default empty) — the uniform backstop: every named
  check must be `success` on the head SHA before an APPROVE is honoured. CI, the
  `waiver-stamp` check itself, and any future lockfile-honesty check are all just entries
  here. Empty ⇒ the caller gated it another way / nothing extra to confirm.
- **`github-token`** (reviewer input, default `${{ github.token }}`) — GITHUB_TOKEN by
  default (zero setup; a GITHUB_TOKEN APPROVE is visible but does **not** satisfy "required
  approving reviews" branch protection). A repo passes an App / bot-PAT token to make
  APPROVE count. The default's non-counting APPROVE usefully bounds the blast radius of any
  residual forgery until a repo explicitly opts into a counting token.
- **Lockfile warning heuristic** — an APPROVE body carries
  *"⚠️ waiver-stamp assumes the lockfile is honest; wire a lockfile-honesty check into
  `required-checks` to remove this caveat"* **iff `required-checks` has ≤ 1 entry** (only
  the base CI check ⇒ no second check that could be the honesty gate). Honoured as
  specified; noted as a heuristic proxy — the precise form (a named
  `lockfile-honesty-check` input) is a future refinement.
- **`.waiver-stamp.json`** — unchanged from §6.3/§6.5 (`allowBumping`, `changeDocs`), read
  from base. The reviewer reads base's copy via `git show` for G2.

---

## 8. Adoption (third-party)

Shipped as a **composite `stamp-check` action + a JavaScript `stamp-review` action + two
copy-paste template workflows** (`examples/`), documented in a dedicated adoption guide and
wired into README §20 step 4.

**Adopter checklist (docs):**
1. Add the `stamp-check` step to CI (after install) — `uses:
   jsalvata/waiver-stamp/.github/actions/stamp-check@<full-SHA>`.
2. Add the reviewer caller workflow — `workflow_run` on your CI, `uses:
   jsalvata/waiver-stamp/.github/actions/stamp-review@<full-SHA>`, set `required-checks`.
3. In branch protection: mark the CI check **and** the `waiver-stamp` check **required**;
   enable **"dismiss stale approvals when new commits are pushed."**
4. Use **merge or rebase-merge**, not squash, so verified commits land as-is (§17.5); or
   have the squash commit carry its own waiver.
5. Set `commitlint`'s `body-max-line-length: [0]` if enforced (§17.4).
6. Protect `.github/**` with CODEOWNERS/rulesets (defense-in-depth behind G1).
7. Optional trust upgrade: pass an App/bot-PAT `github-token` so APPROVE counts; understand
   it runs our code with your write token — pin the action ref by full SHA.
8. Optional: if you set `allowBumping` without a lockfile-honesty check, understand the §3.3
   residual (the APPROVE warning names it).

---

## 9. Dogfooding (this repo)

The waiver-stamp repo installs the exact assets above: `stamp-check` in CI, the
`stamp-review` caller, a real `.waiver-stamp.json`, branch-protection settings, and
merge-mode/commitlint already in place. This is both the reference installation and the
end-to-end test bed (§10).

---

## 10. Testing

- **Unit (vitest, mocked Octokit/`@actions/github`):** verdict → review mapping (every row
  of §5); G1 per-commit detection (including change-and-revert); G2 envelope re-run
  (in/out of envelope) reusing `deps.ts`; required-checks confirmation; idempotent
  sticky-comment/review update; self-heal dismissal; every fail-closed path (missing
  artifact, SHA mismatch, API error, head-moved TOCTOU).
- **End-to-end, real PRs (the ultimate dogfood):** an acceptance harness (`gh`-driven,
  against a sandbox branch in this repo, since it needs the deployed workflow) that opens a
  real PR for **each** verdict and asserts the posted outcome —
  **APPROVE** (a waivered pure rename), **COMMENT** (one stamped + one unwaivered commit),
  **REQUEST_CHANGES** (a present-but-failing waiver → red check; and a forged-APPROVE
  fixture → trust-layer REQUEST_CHANGES), **ABSTAIN** (no waiver blocks). Plus a **G1
  forgery** fixture (a PR editing `.github/**` alongside a stamped rename) asserting no
  APPROVE.
- **Workflow security lint:** `zizmor` + `actionlint` on our own workflows in CI.
- **Bundle drift-guard:** CI rebuilds `stamp-review`'s `dist/` and fails on a diff.

---

## 11. Decisions & rejected alternatives

- **Two-layer split (chosen) over one privileged action (Option A).** Option A runs
  `waiver stamp` — i.e. the repo's TypeScript/linter — in the same job as the write token;
  sandboxing that safely needs containers (a scrubbed env is not enough on a shared runner
  filesystem). The split keeps all attacker-influenceable execution in the unprivileged
  `pull_request` context (which already runs PR code and gets a read-only token on forks)
  and lets the privileged half touch only git data + the GitHub API. It also makes
  `waiver-stamp` a **native required check**, reuses installed deps, and shrinks the
  privileged surface to "submit a review." Net: **zero new attacker code-execution
  surface**, versus A's new privileged one.
- **`REQUEST_CHANGES` reserved for the trust layer (refines §17.2).** With the stamp as a
  required check, an honest `invalid` already blocks the merge and explains itself in the
  job summary; a sticky bot REQUEST_CHANGES on every honest invalid would also create a
  lingering-state trap (GitHub's stale-dismissal clears approvals, not changes-requested).
  So the review channel is reserved for **guard-refuted forged APPROVEs** — exactly §17.2's
  "present claim the tool refuted," the case that genuinely warrants a loud, human-summoning
  flag. Recorded here as a deliberate §18.3 mapping decision.
- **JavaScript reviewer over composite bash.** Reuses `report.ts`/`deps.ts` (no drift),
  robust JSON handling, unit-testable; costs a committed bundle guarded against drift.
- **`workflow_run: [completed]` only.** The `requested`-time "clear stale + post comment"
  behaviour is dropped in favour of GitHub's native stale-dismissal + the check job summary
  — the same user intent with no custom code and no fork-permission gymnastics.

---

## 12. Out of scope / future

- A named `lockfile-honesty-check` input (precise replacement for the ≤1 warning heuristic),
  landing with the firewall integration.
- A `pull_request_target`/comment path for a live status comment on fork PRs (the job
  summary covers this today).
- Auto-merge wiring (a repo composes APPROVE + branch protection itself).
- npm/yarn adopter templates beyond pnpm.

---

## 13. Open questions

None blocking. The two heuristics that are consciously imperfect (the ≤1 lockfile-warning
proxy; the no-branch-protection honest-`invalid` residual) are documented with their exact
future fixes and downside-bounded in the meantime.
