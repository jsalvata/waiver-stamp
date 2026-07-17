# Setup automation — Specification

> Status: **design** (not yet implemented). Collapses the `docs/auto-approval-setup.md`
> checklist from a ~9-step copy-paste-and-edit chore into three pieces: reusable
> workflows the adopter calls in a few lines, a one-click GitHub App provisioning flow,
> and a `waiver setup-repository` command that wires the rest without touching what's already there.

## 1. Purpose & scope

Today, adopting the auto-approval layer means: paste two ~100-line workflow files and
hand-edit their marked points, hand-maintain a `ci-checks` list (with a matrix-leg
footgun), create a correctly-scoped GitHub App by hand (with a permission footgun that
silently doesn't count), set branch protection, patch commitlint, and read a long "why"
for each. `docs/auto-approval-setup.md` is careful and correct — and long, because every
step is manual.

This spec defines three components that shrink that to **run one command, click twice**:

- **A — Reusable workflows** (`workflow_call`): the two templates become thin callers.
  The security-load-bearing shape moves into this repo, versioned and pinned. Required
  checks are **auto-discovered**, deleting the hand-maintained `ci-checks` list (including
  the lockfile-honesty check, assuming `lockfile-assay`).
- **B — App Manifest one-click flow**: provisions a per-adopter App with the exact scopes,
  via GitHub's manifest→conversion handshake. No shared secret, no hosted backend.
- **C — `waiver setup-repository`**: an interactive CLI that validates prerequisites, drives B over a
  loopback server, provisions secrets, merges branch-protection additively, patches
  commitlint, drops the caller workflows without overwriting anything, and ends on a
  hand-off page listing only what we deliberately left manual.

**Non-negotiable carry-over from the core design:** none of this weakens the trust model.
The reviewer still runs **this repo's** pinned default-branch code with the **adopter's**
token; no third party gains standing access; every failure is fail-closed (worst case =
today's normal review). Components A–C reduce *setup friction*, never the safety bar.

**Hard constraint — the target repo is already operational.** `waiver setup-repository` runs against
a fully-configured repo. It must be **additive, idempotent, and non-destructive**: never
overwrite an existing workflow, never replace a branch-protection rule set (only merge in
the checks it needs), back up before editing any tracked file, and re-running must
converge, not duplicate.

Out of scope: changing the stamping engine, the op vocabulary, or the verdict semantics.
This is purely the adoption/onboarding surface.

---

## 2. Component A — Reusable workflows + check autodiscovery

### 2.1 Packaging: thin callers over `workflow_call`

Ship two reusable workflows in this repo under `.github/workflows/`, each exposing a
`workflow_call` trigger and wrapping the existing composite/node actions
(`.github/actions/waiver-stamp`, `.github/actions/waiver-stamp-review`) — the actions stay
the implementation; the reusable workflows are the adopter-facing entry points.

- `jsalvata/waiver-stamp/.github/workflows/ci.yml@vX` — the producer (unprivileged,
  `pull_request`).
- `jsalvata/waiver-stamp/.github/workflows/review.yml@vX` — the reviewer (privileged,
  `workflow_run`).

The adopter's two files collapse to callers. Producer:

```yaml
# .github/workflows/waiver-stamp-ci.yml  (standalone — does NOT touch existing CI)
name: waiver-stamp-ci
on: { pull_request: {} }
jobs:
  waiver-stamp:
    uses: jsalvata/waiver-stamp/.github/workflows/ci.yml@v1.16.0
```

Reviewer (also a standalone file — neither caller touches the adopter's existing CI):

```yaml
# .github/workflows/waiver-stamp-review.yml
name: waiver-stamp-review
on:
  workflow_run:
    workflows: [CI, waiver-stamp-ci]   # <-- discovered & baked in by `waiver setup-repository`
    types: [completed]
jobs:
  review:
    uses: jsalvata/waiver-stamp/.github/workflows/review.yml@v1.16.0
    secrets: inherit
```

The hardened checkout/fetch/guard shape (default-branch checkout, `git fetch` head-as-data,
never-execute-PR-code) now lives inside `review.yml` in **this** repo. Adopters can't
misconfigure it, and we harden it centrally by shipping a new pin.

**Pinning is unchanged in spirit** (`docs/auto-approval-setup.md` §"Which ref to pin"):
`@vX` is paste-safe because we keep `v*` tags immutable; hash-pin adopters swap in the SHA.
The pin now covers the *workflow* as well as the action and CLI — a strictly larger
trusted surface moved off the adopter.

### 2.2 The producer as a standalone workflow

The producer runs as its own `pull_request` workflow rather than a job merged into the
adopter's CI. This is what lets `waiver setup-repository` avoid editing arbitrary CI YAML (§4.8).

It works because the reviewer locates the report **by head SHA across all workflow runs**,
not by the triggering run — `src/action/adapters.ts:fetchArtifact` already
`listWorkflowRunsForRepo({ head_sha })` and its own comment anticipates "the triggering
`workflow_run` may be a different backstop workflow, e.g. CI." So the producer artifact is
found regardless of which workflow woke the reviewer. No code change needed for this.

### 2.3 The reviewer trigger model: multiple workflows, last-wake-wins

Because the producer is separate, a single workflow completion no longer guarantees *all*
required checks are done. The reviewer therefore triggers on **every workflow that
produces a required check** — the adopter's CI workflow(s) **and** `waiver-stamp-ci` — and
re-evaluates on each `completed` event:

- Each wake re-confirms **all** required checks are green on the head SHA (`confirmChecksGreen`
  in `src/action/backstop.ts` — unchanged logic). Not-all-green ⇒ fail-closed no-op.
- The **last** workflow to finish is the wake where everything is green ⇒ it posts.

Cost: up to *k* wakes for *k* triggering workflows, all but the last a cheap no-op. Sound
under the pwn-request model — the reviewer runs trusted default-branch code and re-derives
everything from the head SHA regardless of which workflow triggered it; more wakes just
means more fail-closed no-ops.

`workflow_run.workflows` is static YAML and cannot be discovered at runtime, so the CI
workflow name(s) are the **one** value baked into the caller — `waiver setup-repository` discovers and
fills them (§4.8). This is naming a *workflow*, not maintaining a *check list*; the check
list is what §2.4 removes.

**Can we trigger on *any* workflow, to avoid drift when checks are added?** No wildcard
exists — `workflow_run.workflows` is an explicit name list (`*` is only for `branches`/
`paths`). But the drift concern is mostly already handled: autodiscovery re-reads the
required-check set at runtime by head SHA, so a new check added to an *existing* listed
workflow is picked up with no config change. Only a check added in a *brand-new* workflow
not in the list would be missed — and even then it's fail-closed: the backstop finds it
pending → no-op → at worst a *missed* auto-approval, never a wrong one. If we later want
true "any workflow", the lever is switching the trigger to `check_suite: completed` (fires
per-SHA, name-agnostic) — but that is a different trigger surface needing its own
pwn-request analysis against the `workflow_run` guarantee the whole defense rests on, so
it's deferred, not adopted here.

### 2.4 Check autodiscovery (removes the manual `ci-checks` list)

The reviewer discovers the set of required checks instead of reading a hand-maintained
input. Source of truth: the base branch's **required status checks**, read from the
rulesets endpoint (which surfaces both classic branch protection and rulesets):

```
GET /repos/{owner}/{repo}/rules/branches/{base}
```

collecting every `required_status_checks` rule's `context` values. Fallback to the classic
`GET /repos/{owner}/{repo}/branches/{base}/protection/required_status_checks` if the rules
endpoint yields none (repo still on legacy protection).

This dissolves the two footguns `docs/auto-approval-setup.md` warns about:

- **Matrix legs** — protection stores the *actual* contexts (`integration (9.12.0)`,
  `integration (10.0.0)`), so autodiscovery gets exact leg names for free.
- **Push-only checks** — required status checks are inherently PR checks; a push-only
  `release` job is never in the set, so it can't hang the reviewer.

**Self-exclusion:** the discovered set includes `waiver-stamp` itself (the adopter marks it
required, §4.6). The reviewer must drop its own check name from the backstop set — its
verdict *is* the artifact it trusts, so waiting on it would deadlock. Excluded by a
constant check-name (`waiver-stamp`).

**Base branch, per PR:** discovery keys off `pr.base` (already resolved, `main.ts:59-61`),
so a repo with different protection on different base branches gets the right set per PR.

### 2.5 Lockfile-honesty autodiscovery (assume `lockfile-assay`)

Today `lockfile-honesty-checks` is a separate manual input that (a) joins the backstop set
and (b) flips `lockfileHonestyConfigured`, which silences the "assumes the lockfile is
honest" caveat on APPROVE (`src/action/decide.ts:42`, `main.ts:93`). The (a) part is
subsumed by §2.4 — a required lockfile-honesty check is already in the discovered set and
already must be green; nothing extra to do. Only (b) needs a signal: *which* discovered
check is the honesty gate.

**The check-run name is adopter-defined, so a fixed constant won't match.** It is the
producing job's name/id, not the tool name — in this very repo the `lockfile-assay`
workflow's job is `assay`, so its check-run is **`assay`**, not `lockfile-assay`. Matching a
hardcoded `lockfile-assay` would silently fail here.

Resolution: read the honesty check name from an **optional `lockfileHonestyCheck` field in
`.waiver-stamp.json`** (default absent). This is consistent with how the reviewer already
reads policy from the base commit, so it can't be widened by a PR. `waiver setup-repository` fills it
by detecting the adopter's lockfile-assay workflow and extracting its job/check name (§4.8).
Behavior:

- **Matched** (a discovered required check equals `lockfileHonestyCheck`) ⇒
  `lockfileHonestyConfigured := true`, caveat silenced.
- **Unset or unmatched** ⇒ `lockfileHonestyConfigured := false` — the APPROVE body keeps the
  caveat. This is the **fail-safe** default: the flag only toggles a *warning string*, and
  wrongly *silencing* it is the only harmful direction, so we silence only on a positive
  match. `lockfile-assay` is the assumed tool per directive, but its check *name* is
  discovered, never assumed.

### 2.6 Token & permissions for autodiscovery

Reading required-status-check config needs more than the default token grants. The workflow
`GITHUB_TOKEN` has **no `administration` permission scope** (it is not among the grantable
keys), and the rulesets/branch-protection reads require repository **Administration: read**
for private repos. Therefore autodiscovery reads run under the **App installation token**,
whose App is granted `administration: read` (§3.1). Concretely:

- The reviewer uses the App token (when configured) for the autodiscovery read **and** the
  approve post; it uses the default token only for the reads the default token *can* do.
- Because `waiver setup-repository` always provisions the App (§4.3), the setup-produced configuration
  always has an `administration: read`-capable token — so autodiscovery is available by
  default and the manual list is genuinely gone.

**No-App fallback** (an adopter who declines the App and keeps the human click): the default
token can't read protection, so autodiscovery can't run. In that mode the reviewer falls
back to the optional override input (§2.7); empty ⇒ fail-closed no-op with a clear log line,
never a silent approve. This keeps the happy path list-free without stranding the
default-token path.

> ⚠️ **Verify before build (§7-V1):** whether `GET /rules/branches/{branch}` returns
> `required_status_checks` contexts to a token with only `contents: read` on a *private*
> repo, or truly requires `administration: read`. If `contents: read` suffices, autodiscovery
> also works on the default token and the no-App fallback (§2.7) can be dropped and the App's
> `administration: read` scope removed. The spec assumes the conservative (admin-read) answer.

### 2.7 Override escape hatch (kept, empty by default)

Retain a single optional input `ci-checks` on `review.yml`, **empty by default**. It is not
part of the setup-produced happy path — `waiver setup-repository` writes no list. It exists only for
(a) the no-App fallback of §2.6, and (b) repos whose required set isn't discoverable for
some edge reason. Empty + non-discoverable ⇒ fail-closed no-op (log: "no required checks
discovered and no override set — not approving"). The old `lockfile-honesty-checks` input is
**removed** (folded into §2.5).

---

## 3. Component B — App Manifest one-click flow

Provisions a **per-adopter** App with exact scopes. Each adopter owns their App and holds
their own private key; we distribute a config template, never a shared secret, and run no
backend. Mechanism is GitHub's App-Manifest flow (the same handshake Probot's app-creation
uses in production).

### 3.1 The manifest

```json
{
  "name": "waiver-stamp-<owner>",
  "url": "https://github.com/jsalvata/waiver-stamp",
  "public": false,
  "default_permissions": {
    "contents": "write",
    "pull_requests": "write",
    "administration": "read"
  },
  "default_events": []
}
```

- **`contents: write`** — the documented requirement for an approving review to *count*
  (`docs/auto-approval-setup.md` §8): GitHub counts an App's approval only from an identity
  with repository write access, which for an App is `Contents: write`. Baking it into the
  manifest kills the "I granted only Pull-requests-write and it silently didn't count"
  footgun.
- **`pull_requests: write`** — submit the review.
- **`administration: read`** — read required-status-check config for autodiscovery (§2.6).
  Read-only repo config; low marginal risk over the write scope already present. Drop it if
  §7-V1 shows the default token can read rules.
- **No webhook / no events** — the App is a passive *identity* consumed by the adopter's
  Actions via `actions/create-github-app-token`; it is never a running service. This is the
  key difference from Probot (which wants the webhook secret + a process).

**Name uniqueness.** App names → slugs are globally unique. Suffix the owner login:
`waiver-stamp-<owner>`. Here `<owner>` is whichever account owns the App — the **user**
(personal install) or the **org** — and GitHub uses a **single global namespace** for both
(no user and org can share a login), so the suffixed name is unique regardless of owner
type. Deterministic, which is also the reuse key (§4.3): a second run finds the existing App
instead of colliding. Sanitize to the slug charset (lowercase, non-alphanumeric → hyphen)
and handle the name length cap (truncate long owner logins + short hash suffix).

### 3.2 The flow (loopback, driven by `waiver setup-repository`)

The redirect is captured on **loopback** — no hosted page, and the one-time `code` never
leaves the adopter's machine (strictly more private than a GitHub-Pages redirect, whose
request would transit Pages access logs).

1. `waiver setup-repository` binds `127.0.0.1:<ephemeral-port>`, generates a random `state`.
2. Opens the browser to a page **its own server** serves: a self-submitting `<form method=POST>`
   targeting `https://github.com/settings/apps/new` (personal) or
   `https://github.com/organizations/<org>/settings/apps/new` (org), carrying the manifest and
   `redirect_url=http://localhost:<port>/callback`.
3. Adopter reviews the (pre-scoped) permissions and clicks **Create GitHub App**. The App is
   created **under their account/org**; they own it.
4. GitHub redirects the browser to `http://localhost:<port>/callback?code=…&state=…`; the
   local server captures it (verifies `state`).
5. Server `POST /app-manifests/{code}/conversions` → `{ id, pem, slug, … }`. (Code is
   single-use, ~1h TTL.)
6. Server writes secrets (§4.5) and serves a "done — now install the App" page linking
   `https://github.com/apps/<slug>/installations/new`.

**Non-CLI adopters** don't get a query-param prefill variant — they follow the fully-manual
provisioning process, which we document anyway (§2.8 documentation strategy) and which
doubles as the explanation of what the automated flow does. One less surface to maintain.

### 3.3 The two irreducible clicks

Both stay human by design, not by omission:

- **"Create GitHub App"** — the adopter eyeballing exactly which scopes they grant. We *want*
  a human on `Contents: write`.
- **"Install on this repo"** — GitHub mandates an interactive repo-picker consent; there is no
  self-install API. The CLI can only *open* that page.

Everything between (create POST, code capture, conversion, secret write) is automated.

---

## 4. Component C — `waiver setup-repository`

A new interactive subcommand: `waiver setup-repository`, run from inside the checked-out
repo. Wires everything B doesn't, additively and idempotently, against an
already-operational repo.

### 4.1 Preflight — validate prerequisites (fail fast, fix-it messages)

Check, and on any failure print the exact remediation and exit non-zero **before** mutating
anything:

- **Repo context:** cwd is inside a git work tree with a GitHub `origin`; resolve
  `owner/repo` and the default branch. (Determines personal vs org candidate in §4.2.)
- **`gh` present and authenticated** with a token that can administer the repo (needs repo
  admin to set secrets, edit protection). `gh auth status`; the App token cannot do these —
  this is the adopter's *own* admin credential, deliberately separate from the App key.
- **`git`** present.
- **Package manager:** the dependency-bump op is **pnpm-only** (`allowBumping` is
  pnpm-lockfile-scoped; README "Scope (v0)"). Detect `pnpm-lock.yaml`; warn (don't hard-fail)
  if absent, since the rest of the reviewer layer works without that op. No Node-version
  check — the adopter's repo runtime is irrelevant to the reviewer, which runs waiver-stamp
  via `npx` on the CI runner with Node pinned by the action, not by the adopter.
- **Browser openable** (for the manifest flow) — else fall back to printing the URL.

Preflight always runs (it's read-only and cheap) and gates the rest — there is no separate
`--check` flag; running the command on an already-configured repo converges to a no-op, so
it doubles as the "is my setup healthy?" check.

### 4.2 Choose install target — personal or which org

Prompt: *"Where should the reviewer App live?"* — offer the personal account and each org the
authenticated user belongs to (from `gh api user/orgs`). The answer selects the manifest POST
target (§3.2) and the secret strategy (§4.5).

> **Decision D9 (recorded):** org install is the recommended default when available — org
> Actions secrets make multi-repo reuse near-free (§4.3, §4.5). Personal is offered but the
> prompt notes the per-repo secret consequence. If the user lacks rights to create an App in
> the chosen org (org policy may require an owner or admin approval), detect and message it
> clearly rather than failing opaquely mid-flow.

### 4.3 App provisioning — reuse, disk, or fresh

Resolution order:

1. **Reuse an existing installed App.** Because the name is deterministic
   (`waiver-stamp-<owner>`), check whether it already exists / is installed for this owner.
   - **Org owner:** if the App exists and org secrets are already set (§4.5), **no pem is
     needed** — skip creation, go straight to install-on-this-repo + workflow drop. This is
     the clean reuse path and it sidesteps the "can't re-mint a pem" constraint entirely
     (there is **no REST API to generate an App private key** — UI only, up to 25 keys).
   - **Personal owner:** the App can be reused but personal repos have no shared secret store
     and the pem can't be re-minted headlessly → need the pem from disk (step 2) or a fresh
     key.
2. **Disk (personal, opt-in — §4.4).** If a saved credentials file exists, load
   `{ app_id, pem }` from it and skip the manifest flow.
3. **Fresh manifest flow (§3.2).** Otherwise run the loopback create→convert, obtaining
   `{ app_id, pem, slug }`.

### 4.4 Personal-account pem-on-disk option

Only when the install target is a **personal account** (orgs use org secrets, so no local pem
persistence is needed), one prompt:

- *"Save the App ID + private key to disk so you can configure more of your repos later
  without re-running the browser flow?"* → if yes, write `~/.waiver-install/<owner>.json`
  (`{ "app_id": …, "pem": … }`), **`chmod 600`**, directory `chmod 700`. Warn plainly that
  this is a private key at rest on disk.

On a later run, **if that file exists it is used, silently** — no second preference, no
confirmation. Saving it *is* the opt-in; there's nothing to re-confirm, and it only ever
speeds up the same owner's own subsequent repos.

Never persist a pem for an **org** target; never transmit a pem anywhere; never log it. The
file is the *only* at-rest copy and it is opt-in.

> **Decision D10 (recorded):** default is **not** to persist (secure default). The multi-repo
> convenience is opt-in and personal-only. Alternative considered: always persist to a
> keychain — rejected for v0 (extra platform-specific dependency; disk file with 600 perms is
> adequate and inspectable). Multi-repo for personal accounts is served by the saved file or
> re-minting, not a batch-many-in-one-run mode (dropped as needless complexity).

### 4.5 Secret provisioning

Reviewer references, by convention: `WAIVER_STAMP_APP_ID` and `WAIVER_STAMP_APP_PRIVATE_KEY`.

- **Org target:** set **organization** Actions secrets (`gh secret set --org <org> … --repos
  <repo>` or `--visibility selected`). Set once; every repo's reviewer reads the same org
  secret. Reuse across repos then needs no pem at all (§4.3).
- **Personal target:** set **repo** Actions secrets (`gh secret set … --repo owner/repo`),
  from the fresh pem or the disk file. Multiple personal repos = save the file (§4.4) or
  re-mint per repo; no batch-configure-many-in-one-run mode (it added real complexity for
  little gain).
- **Environment-scoped secrets:** if the reviewer job uses an `environment:` (it need not —
  see §6), create the environment (`gh api`) and set env-scoped secrets to match. Default
  design uses **repo/org** secrets and **no** environment, which is simpler and sufficient;
  environment support is a documented option, not the default.

Multiline pem via `gh secret set … < file` / stdin. We only ever write our two
conventionally-named secrets (`WAIVER_STAMP_APP_ID`, `WAIVER_STAMP_APP_PRIVATE_KEY`);
overwriting *those* on a re-run is idempotent, and we never touch any other secret.

### 4.6 Branch protection & rules — add a dedicated ruleset

The target repo already has protection. **We never read-modify-write it.** We do two things:

- Add a **new, dedicated `waiver-stamp` ruleset** requiring the `waiver-stamp` check on the
  default branch — and *only* that check. The adopter's CI checks are already required
  (that's how autodiscovery §2.4 found them), so there is nothing else to add.
- **Stale approvals — recommend, don't force.** We do *not* flip the repo-wide **"Dismiss
  stale pull request approvals when new commits are pushed"** (a team may deliberately keep
  its own trust policy). Instead the reviewer **dismisses its own prior approval** when a new
  head arrives — it re-evaluates on every push (§2.3), so it calls the dismiss-review API on
  any earlier waiver-stamp approval before deciding afresh. That bounds the exact risk
  dismiss-stale covered — a bot APPROVE from a smaller earlier range lingering — without
  overriding the team. We still *recommend* dismiss-stale on the hand-off page
  (`docs/auto-approval-setup.md` §4).

This is safe — and simpler than a read-merge-PUT — because rulesets **aggregate**: multiple
rulesets on the same branch combine (most-restrictive wins), and rulesets **layer with**
classic branch protection, so the two coexist and both evaluate
([about rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)).
Our ruleset adds our one requirement without merging, migrating, or clobbering anything —
whether the repo runs classic protection, rulesets, or both. Idempotent: a re-run finds our
ruleset and no-ops; we show the adopter the ruleset we'll create and confirm before writing.

`.github/**` protection (CODEOWNERS or a ruleset, `docs/auto-approval-setup.md` §7) is
defense-in-depth behind **G1** — the reviewer guard that already refuses APPROVE if any
commit in the PR range touches `.github/**` (spec §3.4). It's a **recommendation on the
hand-off page** (§4.10), not something setup configures or interactively offers.

### 4.7 commitlint & husky

- **commitlint `body-max-line-length`:** pretty-printed waiver JSON can have body lines over
  the default 100-char limit; a `commit-msg` hook enforcing it would reject waivered commits
  (`docs/auto-approval-setup.md` §6). commitlint config comes in too many shapes to parse
  reliably, so we **detect empirically**: run the repo's `commit-msg` hook (or `npx
  commitlint`) against a synthetic message with a >100-char body line and read the exit code —
  no real commit is created. If it rejects, **warn** the adopter (naming the exact
  `body-max-line-length: [0]` fix) rather than editing their commitlint config for them —
  that config is theirs, and auto-patching it is more intrusive than the problem warrants.
- **husky:** the waiver flow itself needs no husky hook, but if the repo *already* uses husky
  (detect `.husky/`), do not reinitialize it or run `husky install`/`prepare` — leave it
  intact. If we add any hook (we do not by default), it must be appended, never overwrite an
  existing hook file. (This repo's own `.husky/pre-commit` runs `lockfile-assay check
  --staged`; an adopter's hooks are theirs — untouched.)

### 4.8 Workflow files — drop without smashing

- Write `.github/workflows/waiver-stamp-ci.yml` and `.github/workflows/waiver-stamp-review.yml`
  as the thin callers (§2.1). **If either path already exists, do not overwrite** — show a
  diff against what we would write and let the user reconcile; never clobber.
- **Discover the CI workflow name(s)** to bake into the reviewer caller's
  `workflow_run.workflows:` — from `.github/workflows/*.yml` `name:` fields and/or recent
  check-run→workflow associations on a recent PR head SHA. Present the discovered list for
  confirmation. This is the single value that must be right for the trigger model (§2.3).
- **Detect the lockfile-honesty check name** (§2.5): scan `.github/workflows/*.yml` for a job
  using the `lockfile-assay` action/package, extract its job/check name. Feed it into
  `.waiver-stamp.json` `lockfileHonestyCheck` **only via the seeding rule in §4.11** (include
  it when seeding a new file; recommend it on the hand-off page when the file already exists —
  never silently edit an existing policy file). If none found, leave unset (caveat stays —
  fail-safe).
- The producer is standalone, so we **never edit the adopter's existing CI workflow.** (An
  adopter who prefers the producer as a *job inside* their CI can do that by hand — it's on
  the hand-off page as an optional optimization, not something we automate.)

### 4.9 App installation — browser hand-off

Open `https://github.com/apps/<slug>/installations/new` and wait for the user to confirm they
installed it on the target repo (poll `GET /repos/{owner}/{repo}/installation` until present,
or let the user press Enter). Cannot be automated (§3.3).

### 4.10 Finish — the hand-off page (instructions only, no explanations)

End by opening a single page (local HTML served by the setup server, or a stable docs URL
with the repo's specifics filled in) that lists **only the steps we chose not to automate**,
as terse imperatives — no rationale, no prose:

1. Confirm the App is installed on `owner/repo`. *(if not already detected)*
2. Review `.waiver-stamp.json` and set `allowBumping` / `changeDocs` to taste. *(link to the
   recommended-deny template; we drop a closed-by-default file only if none exists — §4.11.)*
3. Set the repo to **merge-commit or rebase-merge** (not squash) to keep per-commit waivers.
4. *(Optional)* Add the `waiver-stamp` producer as a job inside your existing CI workflow
   instead of the standalone workflow.
5. *(Optional)* Protect `.github/**` with CODEOWNERS or a ruleset.

The page is generated with the adopter's `owner/repo`, App slug, and branch names
interpolated, so every step is copy-paste-ready. It explains nothing — the *why* lives in
`docs/auto-approval-setup.md`, linked once at the bottom.

### 4.11 `.waiver-stamp.json`

Policy is a security judgment (what docs/deps you'll auto-waive) — **not automated**
(`docs/auto-approval-setup.md` §3). If the file is **absent**, offer to drop the
closed-by-default recommended template (the exact `changeDocs.allow/deny` from the README,
`allowBumping: []`, plus the detected `lockfileHonestyCheck` from §4.8 if any). If it
**exists**, never touch it — surface it on the hand-off page for the user to review, and if a
lockfile-honesty check was detected but the field is missing, list adding
`lockfileHonestyCheck: "<name>"` as a suggested edit (never auto-applied). Every policy stays
closed-by-default; setup never widens permissions.

Adding `lockfileHonestyCheck` to the config is itself a schema change to
`schema/waiver-stamp-config.v0.schema.json` and the reviewer's base-policy reader — tracked
in the PR 1 tasks (§8).

### 4.12 CLI surface & exit codes

```
waiver setup-repository [--yes] [--target personal|<org>] [--no-app]
```

Run from inside the checked-out repo (it resolves `owner/repo` from the `origin` remote, §4.1).

- `--yes` — accept recommended defaults for non-destructive prompts; still pause on the two
  human clicks (§3.3) and on any destructive-looking merge (§4.6/4.7) unless also explicitly
  confirmed.
- `--target` — skip the §4.2 prompt.
- `--no-app` — skip App provisioning; configure the human-click layer only (§2.6 fallback).

Exit codes reuse the existing contract (`src/commands/report.ts` `EXIT`): `0` success/no-op,
`2` malformed invocation / failed preflight, `3` internal error. Setup is **not** a verdict
command, so it never emits `1` (that code means REQUEST_CHANGES/invalid elsewhere).

Idempotent by construction: every mutating step checks current state first and converges. A
half-finished run (e.g. user closed the browser) is resumable — re-run and it picks up from
the first unsatisfied step.

---

## 5. Security analysis (deltas from the core model)

The core threat model (`docs/automation-layer.md`, spec §3.4) is unchanged. New surface:

- **Reusable workflow holds the shape.** Moving the checkout/fetch/guard shape into
  `review.yml@vX` *reduces* adopter risk (they can no longer misconfigure the pwn-request
  defense) and centralizes hardening. It also *enlarges* the code the adopter trusts by pin —
  mitigated exactly as today by immutable `v*` tags / hash-pinning, now covering the workflow
  too. No new privilege: the reviewer's token scope is unchanged.
- **Autodiscovery reads protection with `administration: read`.** Read-only repo config; it
  cannot mutate anything. It runs under the App token, not a new credential. Worst case of a
  wrong read is a *smaller* or *empty* required set → fail-closed no-op or (if it wrongly
  under-counted) an approve that still required every check it *did* see to be green **and**
  passed G1/G2 — but a maliciously-shrunk required set is not attacker-reachable from a PR
  (protection config is not PR-editable, and G1 blocks `.github/**` edits regardless). Net:
  no new approve-path weakening.
- **App Manifest / loopback.** The pem is created under the adopter's account and never leaves
  their machine (loopback capture, local conversion). No shared secret, no backend, no third
  party gains standing access — the property "no third party holds your write token" is
  preserved. The one-time `code` transits only `localhost`. Standard loopback hardening:
  bind `127.0.0.1` only, verify `state`, single-shot handler, short timeout, ephemeral port.
- **pem at rest (personal, opt-in).** `~/.waiver-install/<owner>.json` at `chmod 600` is a
  private key on disk — the same posture as any local App key or SSH key; opt-in and warned.
  Org installs never persist it.
- **`waiver setup-repository` uses the adopter's own admin credential** (`gh`) for secrets/protection —
  deliberately separate from the App key, and never persisted by us.

Fail-closed remains the invariant everywhere: any ambiguity in setup stops and asks; any
ambiguity in the reviewer yields no review.

---

## 6. Decisions & rejected alternatives

Recorded per the "choose an answer, log the question" directive. Format: **question →
alternatives → chosen (why)**.

- **D1 — Autodiscovery source.** classic branch-protection endpoint · rulesets
  `/rules/branches/{base}` endpoint. → **Rules endpoint, classic as fallback.** Rulesets are
  the modern mechanism and the endpoint surfaces both; classic covers legacy repos.
- **D2 — Token for autodiscovery reads.** default `GITHUB_TOKEN` · App token. → **App token.**
  `GITHUB_TOKEN` has no `administration` scope; the App can hold `administration: read`. Ties
  autodiscovery to the App path, which `setup` always provisions. (Revisit if §7-V1 shows
  `contents: read` suffices.)
- **D3 — Manifest scopes.** minimal (contents+PR) · add `administration: read`. → **Add
  `administration: read`** to enable autodiscovery; read-only, low marginal risk. Drop if
  §7-V1 allows.
- **D4 — Keep any manual check list?** fully remove · keep an empty-by-default override. →
  **Keep an empty override** (`ci-checks`) purely as no-App / edge fallback; happy path writes
  none. Removes the *maintained* list (the user's ask) without stranding the default-token
  path. `lockfile-honesty-checks` input removed (folded into autodiscovery).
- **D5 — Identify the lockfile-honesty check.** fixed name constant · heuristic ("name
  contains lockfile") · optional `.waiver-stamp.json` field filled by setup. → **Optional
  `lockfileHonestyCheck` field**, read-from-base, default fail-safe (unmatched ⇒ keep the
  caveat). A constant is wrong (the check-run name is the adopter's job name — `assay` here,
  not `lockfile-assay`); the field is set by setup from the detected workflow. Flag gates only
  a warning string, so unmatched must fail *safe* (not silence).
- **D6 — Reusable-workflow packaging.** edit adopter's CI to add a job · standalone producer
  workflow + `workflow_call`. → **Standalone + workflow_call for both.** Lets setup avoid
  editing arbitrary CI YAML; the artifact-by-SHA lookup already supports it.
- **D7 — Reviewer trigger with a standalone producer.** trigger only on producer · trigger on
  all check-producing workflows, last-wake-wins. → **Multi-workflow, last-wake-wins.** Avoids
  a race where the reviewer wakes before the adopter's CI finishes and never re-checks.
- **D8 — Inject producer into existing CI?** yes (single wake) · no (standalone). → **No.**
  Can't safely edit arbitrary CI YAML on an operational repo; D7 removes the need. Offered as
  an optional manual optimization on the hand-off page.
- **D9 — Install target default.** personal · org. → **Org recommended when available** (org
  secrets → near-free multi-repo reuse); personal offered with the per-repo consequence noted.
- **D10 — Persist pem on disk?** always · never · opt-in personal-only. → **Opt-in,
  personal-only, `chmod 600`, default off.** Orgs never persist (org secrets suffice).
- **D11 — Secret scope.** repo · org · environment. → **Org for org targets, repo for
  personal; no environment by default** (simplest sufficient; environment supported as an
  option).
- **D12 — Applying branch protection.** read-modify-write the existing rule · add a separate
  dedicated ruleset. → **Add a separate `waiver-stamp` ruleset.** Rulesets aggregate and
  coexist with classic protection, so a new ruleset adds our one required check without ever
  touching the adopter's existing rules — no merge, no clobber, no mechanism-matching (§4.6).
- **D13 — Where the spec lives / feature packaging.** one mega-PR · bookended stack. → **See
  §8** — prep refactor of the reviewer's check-resolution seam, then feature PRs, then
  cleanup.
- **D14 — `waiver setup-repository` vs a separate installer binary.** new `setup` subcommand on the
  existing `waiver` CLI · standalone script. → **Subcommand.** Reuses the shipped bin,
  commander wiring, and exit-code contract; discoverable as `waiver setup-repository`.

---

## 7. Open verification items (resolve during build, not blocking design)

- **V1 — `/rules/branches/{branch}` permission.** Does it return `required_status_checks`
  contexts to a `contents: read` token on a private repo, or require `administration: read`?
  Determines whether §2.6 default-token autodiscovery is possible and whether the App needs
  `administration: read` (§3.1/D3). Spec assumes admin-read (conservative).
- **V3 — localhost as manifest `redirect_url`.** Confirm GitHub accepts an
  `http://localhost:<port>` redirect in the manifest flow (Probot relies on it — high
  confidence, verify at build).
- **V4 — `create-github-app-token` + org secrets.** Confirm the reviewer minting flow reads
  org-scoped secrets identically to repo-scoped (name resolution, `secrets: inherit` through
  the reusable workflow).
- **V5 — Reusable-workflow `secrets: inherit` + App token.** Confirm the App token minted
  inside `review.yml` (from inherited secrets) carries App scopes independent of the caller's
  `GITHUB_TOKEN` permissions block.

---

## 8. Build sequence (bookended)

Reasoning order: feature spike → prep → cleanup. Ship order: 0 → 1..N → N+1.

**Friction found (spike):** the reviewer computes its backstop set inline —
`main.ts:62` does `required = [...ciChecks, ...lockfileHonestyChecks]` straight from static
inputs, and `decide.ts` reads `lockfileHonestyConfigured` from an input length. Autodiscovery
needs to *vary how the required set and the honesty flag are resolved* without touching the
orchestration or the guards. That's a named seam.

- **PR 0 — Prep refactor** (`prep-check-resolution` off `main`): extract required-check
  resolution behind a `resolveRequiredChecks(deps)` seam in the reviewer — today it returns
  the static inputs; behavior-preserving, full suite green before/after. Removes friction:
  *"the backstop set and honesty flag are computed inline from inputs, so autodiscovery can't
  be slotted in without editing `run()`."* This is the only prep item — the rest is greenfield
  (new workflows, new manifest page, new CLI command have no existing code to fight).

- **PRs 1..N — Feature:**
  - **PR 1 — Autodiscovery** (`setup-automation-1`): implement `resolveRequiredChecks` to read
    the rules endpoint (App token), self-exclude `waiver-stamp`, match `lockfile-assay` for the
    honesty flag, keep the empty `ci-checks` override, remove `lockfile-honesty-checks`. Tests
    against faked Octokit (matrix legs, self-exclusion, empty→no-op, rules-then-classic
    fallback).
  - **PR 2 — Reusable workflows** (`setup-automation-2`): add `.github/workflows/ci.yml` and
    `review.yml` (`workflow_call`) wrapping the existing actions; multi-workflow trigger model;
    dogfood this repo onto its own callers; update `examples/` + `docs/auto-approval-setup.md`
    to the collapsed callers.
  - **PR 3 — App manifest + loopback core** (`setup-automation-3`): the manifest builder
    (name/scopes/sanitize), the loopback server (form page, callback capture, conversion),
    browser open. Unit-tested with a fake GitHub endpoint; no secrets written yet.
  - **PR 4 — `waiver setup-repository` orchestration** (`setup-automation-4`): preflight, target prompt,
    App reuse/disk/fresh resolution, secret provisioning, additive branch-protection merge,
    commitlint/husky handling, non-destructive workflow drop, install hand-off, the
    instructions page, `.waiver-stamp.json` seeding. Wired into `cli.ts`. Heaviest PR —
    split further if it crosses ~1000 lines (natural seam: provisioning vs. repo-config).

- **PR N+1 — Cleanup refactor** (`cleanup-setup-automation` off the last feature branch):
  remove the now-dead `lockfile-honesty-checks` plumbing and any manual-list references left
  in docs/examples/action inputs; delete the pre-autodiscovery `ci-checks`-required narration
  from `docs/auto-approval-setup.md` (keep only the override note). Pure removal.

Candidate prep for next time: if a future op needs more repo-config reads, the `gh`-shelling
in PR 4 will want a typed wrapper — note it, don't build it speculatively now.

---

## 9. What this deliberately does **not** automate (and why)

- **The two App clicks** — create (scope review) and install (repo-picker consent). Human by
  GitHub's design and by ours (§3.3).
- **`.waiver-stamp.json` policy** — a security judgment, closed-by-default, never widened by a
  tool (§4.11).
- **Editing the adopter's existing CI workflow** — arbitrary YAML on an operational repo;
  standalone producer removes the need (§4.8, D8).
- **Merge-strategy and `.github/**` protection** — one-click repo settings we surface as
  imperatives on the hand-off page rather than flip silently (§4.10).

Everything else on the `docs/auto-approval-setup.md` checklist is automated or made
paste-safe by A–C.
