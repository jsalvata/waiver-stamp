# Lockfile firewall — design (proposal)

**Status:** proposal for discussion. Companion to spec §6.4 — read that first for the
threat model and the one-paragraph shape of the check.

**Scope.** This document designs the always-on lockfile honesty check (tier 1) and its
mismatch triage (tier 2). Explicitly **out of scope**: authoring-side drift *stability*
(refresh ergonomics, pre-push hygiene, resolver-invocation changes to make honest
lockfiles byte-stable for longer) — that work is being pursued separately. This design
only requires that a mismatch be *classifiable*, not rarer: the interface between the
two efforts is the drift-class report (§4), which must carry enough per-package detail
for any refresh tooling to consume.

## 1. Threat model, by attack shape

CI's `--frozen-lockfile` verifies that the lockfile's *importers* match `package.json`
specifiers, then trusts the transitive graph and every `resolution:` entry wholesale.
Humans don't backstop this: the lockfile is collapsed as generated and never read.

| Attack shape | Frozen install | Human review | Firewall |
|---|---|---|---|
| Registry resolution swapped for a `tarball:` URL (code injection on import) | installs it | never reads the lockfile | tier 1 mismatch → tier 2: undeclared resolution shape → **tamper** |
| Phantom edge injected into a snapshot's `dependencies` | installs it | never reads it | tier 2: edge absent from the real package's manifest → **tamper** |
| Integrity lie for a real `name@version` | install *fails* (registry serves the real tarball; hash mismatch) | — | tier 2: integrity ≠ registry's → **tamper** (defense in depth) |
| Registry redirect via `.npmrc` / workspace config | n/a | **visible diff** — review's job | passes by design (staged under head's config) |
| Choosing an old-but-satisfying version (e.g. pinning a vulnerable one) | installs it | manifest visible; lockfile choice not | tier 2: honest → **drift** class; accepted residual (spec §1.1); §6.3's up-moving gate covers the auto-approve path |

The firewall's claim after a pass: *the lockfile is exactly the derivation of files a
reviewer can actually read* (manifests + committed config). It moves the trust boundary
off the generated file and onto the visible diff. It does **not** vet what the registry
serves — upstream trust stays with `allowBumping` and human review of manifest changes.

## 2. Tier 1 — the byte check

**Trigger.** The PR's **net base→head** diff touches `pnpm-lock.yaml` or any resolution
input (`package.json`, `.npmrc`, `pnpm-workspace.yaml`, `patches/`). Waiver-independent
— this is the point: unwaivered PRs are where the unreviewed channel lives. Net diff,
not per-commit: intermediate lockfile states are installed by no one, and per-commit
checking would veto the routine "fix the lockfile in a follow-up commit" pattern.

**Staging.**

| Input | Taken from | Why |
|---|---|---|
| `pnpm-lock.yaml` | **base** | the reviewed prior state; as pnpm's resolution cache it keeps every still-satisfying locked version pinned, so only changed/new edges resolve fresh |
| `package.json`, `.npmrc`, `pnpm-workspace.yaml`, `patches/` | **head** | visible, reviewable inputs — a registry redirect here is review's job, not the firewall's |
| package manager | head's `packageManager` pin | must be `pnpm@…`; honored by corepack and by pnpm ≥ 10 self-management |

**Invocation.** `pnpm install --lockfile-only --ignore-scripts --prefer-frozen-lockfile`
(same as spec §6.3 step 5). Pre-check the effective `pnpm --version` against the pin: a
skew fails as **toolchain-skew**, its own finding with its own remedy — never conflated
with a resolution mismatch.

**Compare.** Whole-file byte equality against head's committed `pnpm-lock.yaml`.

**Why bytes stay primary** (vs parsing both sides and deep-comparing): byte equality has
zero parser-differential surface — a crafted lockfile cannot parse one way for the
comparator and another way for pnpm. And pnpm's serializer is canonical, so bytes don't
flake by themselves. Verified empirically (2026-07-04, pnpm 9.12.0 and 10.34.1):

- two independent from-scratch resolves of the same manifest are byte-identical;
- `pnpm add pkg@range` produces byte-identical output to copying the resulting manifest
  onto base and re-running the install above (the author path and the verifier path
  agree);
- re-running install on an in-sync tree rewrites nothing (idempotent);
- locked versions that still satisfy their (possibly changed) ranges are **reused**, not
  re-resolved — only specs whose floor moved above base's lock, and edges new to the
  tree, resolve fresh. That fresh surface is the drift residual (spec §9).

Match → the firewall passes; no verdict contribution. Mismatch → tier 2.

## 3. Tier 2 — triage: tamper or drift?

The question tier 2 answers: is the committed lockfile something an honest resolution
**could ever have produced** (against the visible inputs and the real registry), even if
it is not the one produced *today*? It examines the entries on which the committed and
re-resolved lockfiles disagree, plus any committed entry absent from the re-resolution.
Every check uses **time-invariant** registry facts — never "highest satisfying now":

1. **Shape legality.** Every `resolution:` is registry-form (integrity only) unless
   some manifest in head declares a matching non-registry specifier (tarball / git /
   `link:` / `workspace:`); `patchedDependencies` entries correspond to committed
   patches. Undeclared shape → **tamper**.
2. **Registry truth.** For each entry, fetch metadata for the exact `name@version`
   from the registry head's config names: the version must exist and the committed
   integrity must equal the registry's. Deterministic — a published version's tarball
   is immutable (npm forbids republishing a taken `name@version`). Mismatch or
   nonexistent → **tamper**.
3. **Graph consistency.** Every edge in a snapshot's `dependencies` /
   `optionalDependencies` must exist in the real package's own manifest (from the
   metadata fetched in 2) with the resolved target satisfying the declared range; no
   extra edges. Extra or incompatible edge → **tamper**.
4. **Importers.** Lockfile importer specifiers equal head's manifests (what
   `--frozen-lockfile` itself checks). Divergence → **tamper**.
5. **Reachability.** A changed entry unreachable from any importer has no honest
   origin (an honest install prunes orphans) → **tamper**, conservatively.

All disagreeing entries pass → **drift**: the committed lockfile is a valid honest
resolution from some earlier registry state. Report the per-package deltas (committed
vs re-resolved version) plus refresh guidance. Any check fails → **tamper**, naming the
entry and the failed check.

**Open sub-problem — peer suffixes.** Entries like `foo@1.0.0(bar@2.0.0)` encode peer
resolution decisions; fully re-deriving the *legal* suffix set without running the
resolver is the hardest part of tier 2. Options: (a) validate suffix components against
the package's declared `peerDependencies` only — weaker but simple; (b) run pnpm once
more with the committed lockfile as the wanted state and diff its acceptance — stronger
but subtle. Proposal: (a) for the first triage version; measure what it misses.

**Cost.** One metadata fetch per disagreeing entry (cacheable; typically just the
changed subtree). Same registry access + auth the tier-1 resolve already needs.

## 4. Verdict wiring

Config in `.waiver-stamp.json`, read from **base** like `allowBumping`:
`"lockfileFirewall": "off" | "warn" | "enforce"`, default `off`.

| Tier outcome | `off` | `warn` | `enforce` |
|---|---|---|---|
| byte match | not evaluated | pass | pass |
| drift | not evaluated | COMMENT + per-package deltas + refresh guidance | REQUEST_CHANGES + same report |
| tamper | not evaluated | **REQUEST_CHANGES** (proposed — open question 1) | REQUEST_CHANGES |
| toolchain-skew | not evaluated | COMMENT (remedy: align pnpm with the pin) | REQUEST_CHANGES |

`warn` never lets a mismatching PR reach APPROVE — it caps the verdict at COMMENT.

**§6.3 integration.** The bump policy's step 5 is tier 1 under stricter staging (base's
config — which coincides with head's whenever the bump is covered, since a config edit
is an un-covered file) plus the policy gates. One evaluator serves both. The policy
also adopts tier 2's classification in its failure report: a drifted honest bump reads
"drift — refresh", not bare `invalid`.

**Contract note.** This is the stamp's first verdict source that applies to commits
which never embedded a waiver — the stamp becomes a gate as well as an approver. Hence
per-repo config, `off` by default, and open question 3 (own CI check vs stamp verdict).

## 5. Rollout

1. **off** (default at introduction) — code ships dormant.
2. **warn** — collect: mismatch rate, drift:tamper ratio, time-to-refresh on drift
   findings. The classification earns trust here.
3. **enforce** — the veto. Prerequisite: the stamp job has registry reachability and
   auth for every scope the lockfile resolves (private registries included).

Enablement may optionally run the tier-2 audit over the *entire* existing lockfile once
(baseline scan); otherwise the induction base is the trusted status quo, and the
firewall guards deltas from there.

## 6. Non-goals

- Vetting registry *content* (malicious-but-real packages) — upstream trust is
  `allowBumping` + human review of manifest diffs.
- npm / yarn support — roadmap. Notably npm's `package-lock.json` records `resolved`
  URLs in-file, the classic lockfile-injection surface: a richer attack surface and a
  richer checkable structure (tier 2's shape check maps naturally).
- Drift *reduction* and authoring ergonomics — separate work stream (see Scope).

## 7. Open questions

1. Does **tamper veto under `warn`**? Proposed yes — a detected attack should not be a
   comment — but it means a triage bug can block PRs during the trust-building phase.
2. Knob naming and shape: flat `lockfileFirewall` string vs a nested object with room
   for later options (baseline-scan toggle, per-path exemptions).
3. Surface: fold into `waiver stamp`'s verdict (proposed) or expose as a separate
   command (`waiver lockfile-check --base --head`) so branch protection can require it
   independently of stamping?
4. Tier-2 peer-suffix depth (§3).
5. Monorepo scoping: multi-importer workspaces where only some packages' manifests
   change — stage all importers or only affected ones?
6. Should tier 2 also run on byte-*match* as sampled defense-in-depth? Proposed no —
   a match is honest by construction (the re-resolver derived it).
