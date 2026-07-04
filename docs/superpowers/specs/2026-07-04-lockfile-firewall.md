# Lockfile firewall — design (proposal)

**Status:** proposal for discussion. Companion to spec §6.4 — read that first for the
threat model and the one-paragraph shape of the check.

**Scope.** This document designs the always-on lockfile honesty check and its failure
report. Explicitly **out of scope**: authoring-side drift *stability* (refresh
ergonomics, pre-push hygiene, verdict caching, resolver-invocation changes to make
honest lockfiles byte-stable for longer) — that work is being pursued separately. The
interface between the two efforts is the failure report (§4): its per-package
committed-vs-re-derived delta summary must stay consumable by refresh tooling.

## 1. Threat model, by attack shape

CI's `--frozen-lockfile` verifies that the lockfile's *importers* match `package.json`
specifiers, then trusts the transitive graph and every `resolution:` entry wholesale.
Humans don't backstop this: the lockfile is collapsed as generated and never read.

| Attack shape | Frozen install | Human review | Firewall |
|---|---|---|---|
| Registry resolution swapped for a `tarball:` URL (code injection on import) | installs it | never reads the lockfile | byte mismatch — an honest re-resolve never emits the URL entry |
| Phantom edge injected into a snapshot's `dependencies` | installs it | never reads it | byte mismatch — the edge has no honest origin |
| Integrity lie for a real `name@version` | install *fails* (registry serves the real tarball; hash mismatch) | — | byte mismatch (defense in depth) |
| Within-range **version-choice games** (e.g. pinning a real but vulnerable older version) | installs it | manifest visible; the lockfile *choice* is not | byte mismatch — the honest derivation picks its own resolution; **no surveyed alternative closes this channel** (§5) |
| Registry redirect via `.npmrc` / workspace config | n/a | **visible diff** — review's job | passes by design (staged under head's config) |
| Malicious *fresh release* of a real in-range package | installs it (unless quarantined) | — | out of scope — registry-content trust; mitigated by pnpm ≥ 11 `minimumReleaseAge`/`trustPolicy`, which **compose** (§5) |

The firewall's claim after a pass: *the lockfile is exactly the derivation of files a
reviewer can actually read* (manifests + committed config). It moves the trust boundary
off the generated file and onto the visible diff. It does **not** vet what the registry
serves — upstream trust stays with `allowBumping` and human review of manifest changes.

## 2. The check

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

**Why bytes** (vs parsing both sides and deep-comparing): byte equality has zero
parser-differential surface — a crafted lockfile cannot parse one way for the
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

Match → the firewall passes; no verdict contribution. Mismatch → fail closed (§3).

## 3. Mismatch handling

A mismatch conflates **tampering** (content re-resolution cannot derive) with honest
**registry drift** (the registry moved between author time and stamp time). The
firewall treats them identically: same knob-level verdict (§4), same remedy —
**refresh** (re-run the package manager on the branch, amend). The remedy is
self-healing: refreshing a tampered lockfile replaces the poison with the honest
re-derivation, so even a rubber-stamp "just refresh it" response converges to a safe
lockfile. There is deliberately no automated *alarm* — no machine judgment that a
mismatch was an attack rather than drift; the failure report (§4) hands that judgment
to the human reading it, and in a low-drift world (the separately-tracked stability
work) mismatches are rare enough that each one is high-signal by itself.

### Rejected alternative: a registry-truth triage tier

The obvious extension is a classification pass on mismatch: validate each disagreeing
entry against the registry (resolution-shape legality, integrity equality for the
exact `name@version`, graph consistency against the real packages' manifests, importer
equality, reachability), label the mismatch **drift** (all entries honest) or
**tamper** (anything else), and soften the drift verdict. **Rejected 2026-07-04 —
this project will not build it.** Reasons:

- **Zero added detection.** Byte-equality already fails closed on every deviation; a
  classifier would only relabel failures. Its entire payoff assumes drift is *common*
  — it exists to keep an enforce-level veto liveable amid frequent honest mismatches.
- **Drift is being addressed at the source** (stability work: verification near
  authoring plus cached verdicts), which removes that payoff. A classifier for a rare
  event is machinery without a customer.
- **Its hardest sub-problem buys nothing.** Re-deriving the legal peer-suffix set
  without running the resolver is the bulk of the subtlety — all of it in service of
  the relabeling.
- **It would introduce a subtle leniency.** The drift class softens the verdict for
  any mismatch whose entries are individually registry-true — exactly the shape of a
  within-range version-choice attack (pinning a real but vulnerable range-satisfying
  version). With no lenient class, under `enforce` a chosen resolution that differs
  from the honest derivation simply does not merge.

Costs accepted with the rejection: no automated tamper alarm (mitigated by the report
contract below), and no registry-audit machinery that could double as an enablement
baseline scan (§6).

## 4. Verdicts and the failure report

Config in `.waiver-stamp.json`, read from **base** like `allowBumping`:
`"lockfileFirewall": "off" | "warn" | "enforce"`, default `off`.

| Outcome | `off` | `warn` | `enforce` |
|---|---|---|---|
| byte match | not evaluated | pass | pass |
| mismatch | not evaluated | COMMENT (caps the verdict — never APPROVE) | REQUEST_CHANGES |
| toolchain-skew | not evaluated | COMMENT (remedy: align pnpm with the pin) | REQUEST_CHANGES |

**The failure report contract** (required, not cosmetic — it carries the judgment a
classifier would have automated):

- a bounded **diff excerpt** of committed vs re-derived lockfile — a version delta reads
  as drift; a `tarball:` URL or a novel edge reads as an attack;
- a **per-package delta summary** (committed vs re-derived version per disagreeing
  package) — computed by parsing the two lockfiles locally, **no registry queries**;
  this is also the interface consumed by the drift-stability tooling;
- the **refresh recipe**, verbatim;
- **toolchain-skew** reported as its own failure with the pinned vs effective versions.

A §6.3 step-5 (dependency-bump policy) failure shares this contract.

## 5. Prior art

Surveyed 2026-07-04, prompted by "surely someone has done this". Partial solutions
exist — the wave dates from the 2025–26 npm compromise era (Shai-Hulud, Glassworm) —
but none re-derives from base and compares bytes, and none closes the version-choice
channel.

- **Yarn Berry hardened mode** (`enableHardenedMode`, Yarn 4, 2023) — the nearest
  neighbour. On install it requires every resolution to be a *valid candidate* for its
  range (`--check-resolutions`) and lockfile metadata to match the registry
  (`--refresh-lockfile`). Two gaps the firewall closes: it accepts **any** range-valid
  registry-true resolution, so version-choice games pass — that leniency is how it
  bought drift immunity, the same trade the rejected triage-tier alternative (§3)
  would have made; and
  it runs inside the PR's own install under PR-editable `.yarnrc.yml`, **default-on
  only for public GitHub PRs** — off exactly where the modern threat lives (private
  repos, compromised-maintainer and agent-authored PRs). The firewall's knob is read
  from base and enforced from the stamping layer.
- **pnpm ≥ 11 install-time hardening** — integrity mismatches are hard failures
  (`ERR_PNPM_TARBALL_INTEGRITY`, 11.4), missing-integrity entries rejected, explicit
  tarball URLs checked against registry metadata, `blockExoticSubdeps` (no git/tarball
  resolutions in transitive deps), `minimumReleaseAge` (quarantine window on fresh
  releases), `trustPolicy`. **Composes, doesn't compete**: it protects every install
  everywhere (dev machines included) but does not validate the graph (phantom edges to
  real registry packages pass frozen installs) and accepts any valid version choice.
  Synergy worth exploiting: `minimumReleaseAge` committed in base config is honored by
  the firewall's own re-resolve (staging runs under committed config), so it
  quarantines fresh malware *and* stabilizes re-resolution — a direct assist to the
  drift-stability work.
- **lockfile-lint** (~2019) — static shape lint over npm/yarn `resolved` URLs (allowed
  hosts/registries, https, integrity presence). No re-derivation; pnpm's registry
  entries carry no URLs, so it has little to check there.
- **Lockfile-changed-without-manifest tripwires** (CI actions) — a one-signal
  heuristic; misses poison folded into a legitimate-looking bump.
- **Folk practice** — the lockfile design-space study (arXiv 2505.04834) records a
  practitioner doing exactly this check by hand: *"I'll pull their change into a
  branch… and then see if my lockfile changed in the exact same way."* The firewall is
  that practice, automated and anchored where the PR can't switch it off.

References: [Yarn security features](https://yarnpkg.com/features/security) ·
[pnpm 11.4 release notes](https://pnpm.io/blog/releases/11.4) ·
[npm supply-chain defenses survey, 2026](https://mondoo.com/blog/npm-supply-chain-security-package-manager-defenses-2026) ·
[The Design Space of Lockfiles Across Package Managers](https://arxiv.org/html/2505.04834v3)

## 6. Rollout

1. **off** (default at introduction) — code ships dormant.
2. **warn** — collect: mismatch rate and human dispositions (refreshed vs investigated).
3. **enforce** — the veto. Prerequisites: the stamp job has registry reachability and
   auth for every scope the lockfile resolves, and drift is demonstrably rare (the
   stability work has landed; warn-mode metrics are quiet).

Enablement trusts the existing lockfile as the induction base — the design has no
built-in whole-lockfile baseline audit (the rejected triage machinery, §3, would have
doubled as one); a repo that wants a baseline can lean on pnpm ≥ 11's install-time
checks or an external scanner as a compensating one-time scan.

Caveat for the automation layer: the firewall's anchor is only as strong as the CI
wiring — a required check whose workflow the PR itself can edit needs protecting (org
rulesets / required workflows), same as the rest of the stamp.

## 7. Non-goals

- Vetting registry *content* (malicious-but-real packages) — upstream trust is
  `allowBumping` + human review of manifest diffs, plus pnpm ≥ 11 runtime policies.
- Mismatch classification — rejected, §3.
- npm / yarn support — roadmap. npm's `package-lock.json` records `resolved` URLs
  in-file, the classic injection surface: a richer attack surface and a richer
  checkable structure.
- Drift *reduction* and authoring ergonomics — separate work stream (see Scope).

## 8. Open questions

1. Is `warn` an acceptable rollout stage given that, without classification, a real
   attack surfaces during it as a COMMENT-capped mismatch rather than a veto? (The
   self-healing refresh bounds the damage — the poison cannot merge *as committed* once
   anyone refreshes — but a repo that merges on COMMENT without refreshing keeps the
   committed bytes.)
2. Knob naming and shape: flat `lockfileFirewall` string vs a nested object with room
   for later options (per-path exemptions, report verbosity).
3. Surface: fold into `waiver stamp`'s verdict (proposed) or expose as a separate
   command (`waiver lockfile-check --base --head`) so branch protection can require it
   independently of stamping?
4. Monorepo scoping: multi-importer workspaces where only some packages' manifests
   change — stage all importers or only affected ones?
