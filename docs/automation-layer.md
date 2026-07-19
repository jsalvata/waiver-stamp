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

**The sequence, end to end:**

1. **Stage 1 — the `waiver-stamp` check (unprivileged), computes the verdict.** A PR push
   runs it as ordinary CI (`on: pull_request`; a read-only token on forks). It runs
   `waiver stamp --json` over the PR range, writes the verdict to the job summary (instant
   per-push feedback), uploads the report as a run artifact — the interface contract (§4.3)
   — and sets its check conclusion (fail iff `REQUEST_CHANGES`). It reuses the build job's
   already-installed dependencies, so it emits with the repo's own TypeScript (§9) at no
   extra cost, and its check becomes a **named required status** the repo can gate on.
2. **Stage 2 — the `waiver-stamp-review` action (privileged), only submits a review.** When
   a backstop workflow completes it wakes via `workflow_run`, running from the
   **default-branch** definition in base-repo context with a write token. It resolves the PR
   + head SHA from the event, confirms the required checks (autodiscovered from the base
   branch's protection) are green on that SHA (else no-op), locates the `waiver-stamp`
   producer run for the SHA and downloads + zod-validates its artifact, runs the G1/G2 trust
   guards (§3), and posts the mapped GitHub review (§5). It **never runs the repo's
   toolchain**, so the write token never sits next to attacker-influenceable code execution,
   and it trusts the artifact **only after** the
   guards re-establish, from git data alone, that it could not have been forged.

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
branch.** The reviewer's own code, its required-check resolution, and its orchestration are
tamper-proof from a PR. On top of that fixed point, the reviewer re-establishes trust using
**only git file data — no untrusted code ever executes in the privileged context:**

- **G1 — workflow integrity.** No commit in `base..head` touches `.github/**` (checked
  **per-commit** via `git log --name-only`, not the net diff — a change-and-revert nets to
  zero but still poisons the intermediate trees the stamp folded through). Any hit → the
  workflow the stamp ran under, and the job graph that produced the checks, are not the
  reviewed ones → **never APPROVE**. Kills both the workflow-edit and check-name-minting
  forgeries.
- **G2 — dependency integrity.** Two independent re-derivations over the range:
  - **Resolution inputs (fail-closed, per-commit).** Any commit touching a file that changes
    what `pnpm install` executes — `.pnpmfile.cjs`, `.npmrc`, `patches/**` / `*.patch` /
    `*.diff`, `pnpm-workspace.yaml`, `package.yaml`, `package.json5` (matched by basename, at
    any depth) — is refused outright. These have no "honest bump" envelope: the engine
    already treats every one as uncovered (they clear no `change-*` op), so a stamped commit
    never touches them. Because the *producer* runs `pnpm install`, a poisoned `.pnpmfile.cjs`
    is exactly how a forged APPROVE gets computed in the first place — so this is the
    resolution-input analogue of G1, per-commit for the same change-and-revert reason.
  - **Manifest envelope (net diff).** If any commit touches `package.json` / the lockfile, the
    reviewer **independently re-runs §6.3 gates 1–4** over the range (reusing the engine's own
    `deps.ts` gates, reading base+head `package.json` and base's `.waiver-stamp.json` as blobs
    via `git show <ref>:<path>` — no worktree, so the untrusted head tree is never materialized
    on disk). The bump must be confined, allowlisted, plain-semver, and up-moving, exactly as an
    honest engine-level APPROVE required.
  - Any violation from either check → the artifact's APPROVE could not have been honestly
    computed → **never APPROVE**.

**Why the guards suffice.** With G1 clean, the workflow files are the reviewed ones. With
G2 clean, the toolchain that executed during stamp is base's (already default-branch
reviewed): no PR-introduced resolution input (`.pnpmfile.cjs`, `.npmrc`, patches, alt
manifests) rode along in the producer's `pnpm install`, and any allowlisted manifest bump
stayed in envelope. Head *source* is only *emitted* by `waiver stamp` (ts-morph/tsc emit
does not run user code), never executed. A malicious `tsconfig` transformer can't ride
along either:
`tsconfig` is a non-excludable byte-compared file (§7), so any change makes the stamp
itself not-APPROVE. Once G1+G2 pass, the artifact is exactly as trustworthy as the honest
run that produced it.

**Trust invariant that powers §5:** *an honestly-computed APPROVE implies G1 and G2 pass.*
A stamped commit cannot touch `.github/**` or any resolution input (all are uncovered by
every op — the `change-docs` extension floor and the `change-test` backstop-integrity
exclusion both refuse them), and a manifest-touching commit only stamps if the engine
already ran gates 1–4. So **guards-fail + artifact-says-APPROVE ⇒ the artifact was not
honestly computed** —
a forgery, a bypass attempt, or engine-version skew between the two halves. That is the one
case worth actively flagging.

### 3.3 The honest-lockfile boundary (stated precisely)

Per the approved decision, the layer **assumes the lockfile is honest** (there is no
lockfile-honesty tool wired in yet; the firewall is a separate, not-yet-integrated
product).

- **Default config (`allowBumping` absent/empty):** G2 reduces to "no manifest/lockfile
  change *and* no resolution-input change at all" — the resolution-input check runs
  regardless of `allowBumping`, so the toolchain-trust chain is **closed**: no honesty check
  is needed for the APPROVE path to be sound.
- **With `allowBumping` set and no honesty check:** a lockfile entry for an allowlisted
  package that keeps the version string but points at a poisoned tarball passes gates 1–4,
  executes during the stamp install, and could forge the report. This is §6.3.5's warning,
  extended to the automation layer — the **accepted residual** the APPROVE warning banner
  covers (§5, §7).
- **Resolution inputs are a superset, not a re-implementation of lockfile-assay.** lockfile-assay
  *adjudicates* install inputs (it can allow a visible registry redirect or a hashed-only patch);
  G2 has no safe way to run that analysis and no need to — a resolution-input change is never a
  mechanical refactor, so it refuses the whole category (`RESOLUTION_INPUTS` in `guards.ts`). The
  guard only has to stay *at least as strict* as lockfile-assay's input list; once the firewall is
  wired in as a required lockfile-honesty check (named in `.waiver-stamp.json`'s
  `lockfileHonestyCheck`), the precise adjudication lives there and this guard
  is a pure backstop.

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
  `contents`, `actions: read`), `persist-credentials: false`, third-party actions pinned per a
  committed `.github/zizmor.yml` policy (the dogfood accepts the repo's tag-pin convention;
  SHA-pinning is the stricter option an adopter can adopt), dependency-light bundle. `zizmor`
  + `actionlint` run green on our workflows in CI (template-injection, credential-persistence,
  and excessive-permissions all fixed in code, not configured away).
- **Trusted action code, PR content as data (pwn-request).** The privileged reviewer job must
  execute **its own default-branch (or externally-pinned) action code**, never the PR head's
  version of `dist/index.js` — running head-authored action code with the write token would be
  a pwn-request, and G1 (which runs *inside* the action) cannot defend against a compromised
  action. Adopters pin the action to `jsalvata/waiver-stamp/…@<sha>` (§8), so the workspace
  checkout of the PR head is pure data. The dogfood's local `uses: ./…` achieves the same by
  checking out the **default branch** for the code and `git fetch`-ing the head SHA's commits
  into the object store as G1/G2 data (never checking out or executing the head tree).
- **Fork edges** — first-time-contributor workflow-approval gates mean no run / no artifact
  → reviewer no-ops. Every guard failure, missing check, or API error is fail-closed.
- **Our own supply chain** — a consumer's reviewer runs **our** code with **their** write
  token. Adoption docs mandate full-SHA pinning of the action ref. This repo auto-publishes
  to npm on merge to `main`, so our own dogfood (approve → auto-merge → release) is itself a
  supply-chain-sensitive target; a human stays on the merge button for non-stamped PRs.

---

## 4. Components

### 4.1 `waiver-stamp` — unprivileged CI action (composite)

`/.github/actions/waiver-stamp/action.yml`. A thin composite step a consumer appends to
their existing build job (after `install`), or runs as a small dedicated job on
`pull_request`.

- **Inputs:** none. The step runs **the CLI release that ships at the action's own pinned ref**,
  reading the version out of its own checkout (`$GITHUB_ACTION_PATH/../../../package.json`), so an
  adopter's `uses: …@<ref>` pin covers the tool that computes the verdict, not merely the shell
  script that invokes it. To run a different CLI version, move the ref.
- **Behaviour:** resolve `base = event.pull_request.base.sha`,
  `head = event.pull_request.head.sha`; run `waiver stamp --base --head --json`; write the
  verdict + per-commit findings to the **job summary**; upload the report (plus the `base`
  and `head` SHAs it used) as a **GitHub Actions run artifact** named `waiver-stamp-report`
  (`actions/upload-artifact`, attached to this workflow run; the reviewer fetches it via the
  Artifacts API, §4.3); set the job **conclusion**
  = failure iff verdict is `REQUEST_CHANGES` (an honest failed claim blocks the merge right
  where the author iterates), else success/neutral.
- **The artifact uploads regardless of conclusion** (`if: always()`, before the failing
  exit) so the reviewer can distinguish an honest `invalid` (artifact present, verdict
  `REQUEST_CHANGES`) from a missing artifact (fail-closed neutral). Conclusion and artifact
  are independent signals.
- Needs only the read token forks get. Requires `fetch-depth: 0` checkout (stamp walks the
  commit range).

### 4.2 `waiver-stamp-review` — privileged reviewer action (JavaScript)

`/.github/actions/waiver-stamp-review/`. A **JavaScript action** (TypeScript source under
`src/action/`, bundled to a committed `dist/index.js`), chosen so it reuses `report.ts`
types and `deps.ts` gates directly — the verdict mapping and the G2 re-run cannot drift
from the engine, and it is unit-testable with vitest against a mocked Octokit.

- **Trigger (consumer's caller):** `workflow_run: { workflows: [<every backstop-producing
  workflow>], types: [completed] }`. Naming *all* producers (CI, the `waiver-stamp` workflow,
  any honesty workflow) is what lets the reviewer wake on the **last** green light — not just
  the artifact producer; `workflow_run` also avoids the self-trigger loop a bare `check_suite`
  trigger would cause (rationale in §7).
- **Required checks:** **autodiscovered** from the base branch's protection — read from
  **both** the rulesets endpoint and classic branch protection and **unioned**; each surfaces
  only its own mechanism, so a repo may require checks under either or both (e.g. classic CI
  checks alongside a dedicated `waiver-stamp` ruleset, exactly what setup adds). The classic
  read needs the App token's `administration: read` and 403s a token lacking it (a permission
  check before the existence check), which fails the whole union; the rules read needs only
  `metadata: read`. So discovery only succeeds with the App token — a non-admin token's 403
  makes discovery fail and the reviewer falls back to `ci-checks`, an optional
  **empty-by-default override** (empty ⇒ fail-closed). The `waiver-stamp` check is
  self-excluded (its verdict is the artifact). `github-token` (default `${{ github.token }}`;
  a repo passes an App / bot-PAT token to make APPROVE count and to grant the admin-read
  autodiscovery needs).
- **Behaviour:** resolve the PR + `head_sha` from the `workflow_run` event (no-op if no open
  PR); confirm every autodiscovered required check (`waiver-stamp` self-excluded) is
  `success` on `head_sha` (not all green → no-op; a later completion wakes us); **locate the
  `waiver-stamp` producer run for `head_sha`** (the triggering run may be CI, not the
  producer) and download + zod-validate its `waiver-stamp-report` artifact; **independently
  derive** `base` and cross-check the artifact's SHAs (`head` must equal the event
  `head_sha`; mismatch → neutral no-op); run **G1** and **G2**; map the verdict to a review
  per §5; dismiss its own stale
  reviews (§6).
- **Dependencies:** `@actions/core`, `@actions/github`, `zod` (artifact validation),
  `semver` (via the reused `deps.ts` gates). Bundle kept in sync by a CI drift-guard that
  rebuilds and diffs `dist/` (mirrors the existing schema drift-guard).

### 4.3 The artifact contract (`waiver-stamp-report`)

The single interface between the halves. A JSON document: the §17.3 `VerifyReport`
(`verdict` + per-commit results) plus `{ base, head }` (the SHAs the stamp used) and
`{ toolVersion }` (for engine-skew diagnostics). zod-validated by the reviewer before any
use; the reviewer trusts none of its SHAs without cross-checking against the event.

### 4.4 Workflows & config in this repo (dogfood)

- Add the `waiver-stamp` step to this repo's CI (a step in the build job or a dedicated
  `pull_request` job producing the artifact + the `waiver-stamp` check).
- `/.github/workflows/waiver-stamp-review.yml` — the reviewer caller
  (`workflow_run` on our CI; required checks autodiscovered from branch protection;
  `github.token`).
- `/.waiver-stamp.json` at the repo root — a real config (`allowBumping`, `changeDocs`) so
  the repo *is* a working example.

---

## 5. The reviewer decision table

The verdict → output mapping, realized on the two-layer mechanics. Because
`waiver stamp` runs as a **required check**, an honest `invalid` already blocks the merge
and explains itself in the job summary; the **review channel is reserved for the trust
layer**. (This is a deliberate, recorded refinement of §17.2's literal "invalid →
request-changes review" — see §11.)

Rows below assume the artifact is present and zod-valid; **backstop** = the autodiscovered
required checks (the `waiver-stamp` check is **not** in it — its verdict *is* the
artifact).

| Situation | Reviewer output |
|---|---|
| Any backstop check not yet green on `head_sha` | **No-op** — a later `workflow_run` completion wakes us |
| `APPROVE`, G1+G2 pass, backstop green | **APPROVE** review (+ lockfile warning when `allowBumping` is set and no required check matches `lockfileHonestyCheck`, §7) |
| `APPROVE`, G1 or G2 **fails** | **REQUEST_CHANGES** review — "the trusted layer refuted this claim"; **no artifact content echoed** |
| `COMMENT`, G1+G2 pass, backstop green | **COMMENT** review — the vouched-subset note |
| `COMMENT`, G1 or G2 **fails** | **COMMENT** review — reviewer-authored generic "couldn't verify these results; full review applies" (**no subset echoed**, so a forged COMMENT can't steer reviewers) |
| `REQUEST_CHANGES` (honest invalid), guards either way | **Nothing** — the red `waiver-stamp` check already blocks and explains |
| `ABSTAIN`, guards either way | **Nothing** (§17.2 downside-bound) |
| Artifact missing / malformed / SHA-mismatch / head-moved / any API error | **Quiet fail-closed** — no review, neutral note |

**Exhaustive over `verdict × guards × backstop`.** Guards change the outcome only for
`APPROVE` (→ REQUEST_CHANGES) and `COMMENT` (→ generic note); `REQUEST_CHANGES` and
`ABSTAIN` are **Nothing** regardless of guards or backstop, and a non-green backstop is
always a no-op. So "G1/G2 fails while the artifact claims anything other than APPROVE" is a
**COMMENT** only for the `COMMENT` verdict — for `REQUEST_CHANGES`/`ABSTAIN` it stays
Nothing (the red check / absent claim already cover them). Every remaining
(verdict, guards, backstop) combination is a row above.

**Self-healing.** On each cycle the reviewer **dismisses its own prior REQUEST_CHANGES** if
the new head's guards pass — an attack flag must not permanently brick a PR that has since
been fixed honestly. Dismissed reviews remain in the timeline as the audit trail.

**Residual, accepted:** in a repo with **no branch protection**, an honest `invalid`
produces only a red check (no PR-conversation review). Still downside-bounded (the PR falls
to whatever review that repo does today); adoption docs list "mark the stamp check
required" as a prerequisite regardless.

---

## 6. Review lifecycle & idempotency

- **Fast feedback, no stale approval.** The `waiver-stamp` **job summary** shows the current
  verdict on every push, natively, with no token. A prior APPROVE is cleared by GitHub's
  native stale-dismissal on push. The reviewer re-evaluates on the new SHA and only ever
  approves once that SHA's checks are green.
- **Approval gated on green.** The reviewer submits an APPROVE only on a `workflow_run`
  completion where the full autodiscovered required set is green — the last workflow to
  finish is the wake-up on which the set is finally green. No polling, no waiting.
- **Idempotency.** A `concurrency` group keyed on the PR serializes review mutations; the
  reviewer keeps a **single** active review (re-submitting or dismissing its own, never
  stacking), so simultaneous wake-ups collapse to one outcome. Running status is the
  producer's job summary — the reviewer posts no bot comment (formal reviews only).

---

## 7. Configuration surface

- **Required checks — autodiscovered.** The backstop set is the **union** of the base
  branch's rulesets endpoint and classic branch protection — each surfaces only its own
  mechanism, so a repo may require checks under either or both. The classic read needs the
  App token's `administration: read` and 403s a token lacking it (before the existence
  check), which fails the whole union read — so a non-admin token can't autodiscover at all.
  On that failure the reviewer falls back to `ci-checks`, an optional empty-by-default
  override (empty ⇒ fail-closed). The `waiver-stamp` check is self-excluded (its verdict is
  the artifact).
  *Why not deduce these from the trigger, or trigger on check events?* A trigger's
  `workflows:` are *workflow* names; a backstop is a *check-run* name (one workflow can emit
  many checks) — the mapping isn't 1:1, and the reviewer sees one event at a time, so it
  can't enumerate the set from the trigger. A `check_suite`/`check_run` trigger would spare
  the `workflows:` list but (a) fires on the reviewer's **own** run's suite → a self-trigger
  loop, and (b) is blind to legacy commit *statuses*. So the trigger names the explicit
  producer workflows, and the required-check *set* is read from branch protection rather
  than hand-listed.
- **`github-token`** (reviewer input, default `${{ github.token }}`) — GITHUB_TOKEN by
  default (zero setup; a GITHUB_TOKEN APPROVE is visible but does **not** satisfy "required
  approving reviews" branch protection). A repo passes an App / bot-PAT token to make
  APPROVE count. The default's non-counting APPROVE usefully bounds the blast radius of any
  residual forgery until a repo explicitly opts into a counting token.
- **Lockfile warning.** When `allowBumping` is set, an APPROVE body carries
  *"⚠️ waiver-stamp assumes the lockfile is honest; name your lockfile-honesty check in
  `.waiver-stamp.json`'s `lockfileHonestyCheck` to remove this caveat"* **unless**
  `lockfileHonestyCheck` names a check that is in the discovered required set. With
  `allowBumping` empty, G2 refuses every manifest/lockfile/resolution-input change, so
  lockfile honesty is moot and the caveat never appears. Fail-safe: when bumping is allowed,
  the caveat is silenced only on a positive match, so a missing or misnamed field keeps it.
- **`.waiver-stamp.json`** (`allowBumping`, `changeDocs`, and the optional
  `lockfileHonestyCheck`), read from base. The reviewer reads base's copy as a git blob
  (`git show <base>:.waiver-stamp.json`, no worktree) — for G2's envelope re-run and the
  honesty-check lookup.

---

## 8. Adoption (third-party)

Shipped as a **composite `waiver-stamp` action + a JavaScript `waiver-stamp-review` action +
two copy-paste template workflows** (`examples/`), documented in a dedicated adoption guide
and wired into README §20 step 4.

**Adopter checklist (docs):**
1. Add the `waiver-stamp` step to CI (after install) — `uses:
   jsalvata/waiver-stamp/.github/actions/waiver-stamp@<full-SHA>`.
2. Add the reviewer caller workflow — `workflow_run` on all backstop workflows, `uses:
   jsalvata/waiver-stamp/.github/actions/waiver-stamp-review@<full-SHA>`; required checks
   are autodiscovered from branch protection; name your lockfile-honesty check in
   `.waiver-stamp.json`'s `lockfileHonestyCheck` if you have one.
3. In branch protection: mark the CI check **and** the `waiver-stamp` check **required**;
   enable **"dismiss stale approvals when new commits are pushed."**
4. Use **merge or rebase-merge**, not squash, so verified commits land as-is (§17.5); or
   have the squash commit carry its own waiver.
5. Set `commitlint`'s `body-max-line-length: [0]` if enforced (§17.4).
6. *(Optional, recommended)* Protect `.github/**` with CODEOWNERS/rulesets — defense in
   depth behind G1, which already blocks any `.github/**` change from an APPROVE.
7. Optional trust upgrade: pass an App/bot-PAT `github-token` so APPROVE counts; understand
   it runs our code with your write token — pin the action ref by full SHA.
8. Optional: if you set `allowBumping` without a lockfile-honesty check, understand the §3.3
   residual (the APPROVE warning names it).

---

## 9. Dogfooding (this repo)

The waiver-stamp repo installs the exact assets above: `waiver-stamp` in CI, the
`waiver-stamp-review` caller, a real `.waiver-stamp.json`, branch-protection settings, and
merge-mode/commitlint already in place. This is both the reference installation and the
end-to-end test bed (§10).

---

## 10. Testing

- **Unit (vitest, mocked Octokit/`@actions/github`):** verdict → review mapping (every row
  of §5); G1 per-commit detection (including change-and-revert); G2 dependency integrity —
  resolution-input detection (per file type, nested, change-and-revert) and the envelope
  re-run (in/out of envelope) reusing `deps.ts`; autodiscovery of the required set (rules
  endpoint, classic fallback, `waiver-stamp` self-exclusion) and the fail-safe honesty flag;
  backstop confirmation over the discovered set; idempotent review update; self-heal
  dismissal; every fail-closed path (missing artifact, SHA mismatch, API error, head-moved
  TOCTOU).
- **End-to-end, real PRs (the ultimate dogfood):** an acceptance harness (`gh`-driven,
  against a sandbox branch in this repo, since it needs the deployed workflow) that opens a
  real PR for **each** verdict and asserts the posted outcome —
  **APPROVE** (a waivered pure rename), **COMMENT** (one stamped + one unwaivered commit),
  **REQUEST_CHANGES** (a present-but-failing waiver → red check; and a forged-APPROVE
  fixture → trust-layer REQUEST_CHANGES), **ABSTAIN** (no waiver blocks). Plus a **G1
  forgery** fixture (a PR editing `.github/**` alongside a stamped rename) asserting no
  APPROVE.
- **Workflow security lint:** `zizmor` + `actionlint` on our own workflows in CI.
- **Bundle drift-guard:** CI rebuilds `waiver-stamp-review`'s `dist/` and fails on a diff.

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
- **`workflow_run` over a `check_suite`/`check_run` trigger.** Check-event triggers would
  spare naming the producer workflows, but a workflow's own completion (the reviewer's
  included) emits a check suite → a self-trigger loop, and check events are blind to legacy
  commit *statuses*. `workflow_run` naming the explicit producer set avoids both and hands
  the reviewer run context for artifact retrieval. So the trigger names the explicit
  producer workflows, while the required-check *set* is the **union** of the rulesets endpoint
  and classic branch protection — each surfacing only its own mechanism, the classic half
  read under the App's `administration: read` — with `ci-checks` as an empty-default
  override.

---

## 12. Out of scope / future

- A `pull_request_target`/comment path for a live status comment on fork PRs (the job
  summary covers this today).
- Auto-merge wiring (a repo composes APPROVE + branch protection itself).
- npm/yarn adopter templates beyond pnpm.

---

## 13. Open questions

None blocking. One consciously-accepted residual remains — in a repo with no branch
protection, an honest `invalid` surfaces only as a red check (no PR-conversation review) —
documented, downside-bounded, and covered by the "mark the stamp check required" adoption
prerequisite. (The lockfile warning is *precise*, keyed on whether `allowBumping` is set and the base
config's `lockfileHonestyCheck` names a required check, so it is no longer a heuristic.)
