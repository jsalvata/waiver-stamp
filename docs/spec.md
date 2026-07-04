# waiver-stamp — Specification

> **waiver-stamp**: a tool that auto-approves PRs whose safety can be proven
> mechanically. A **waiver** is a JSON recipe describing a change; **stamping** is
> validating a PR's diff against its waiver. Status: **draft (v0 design)**.
> Scope here: the **runner** (applies waivers) and the **stamper** (validates them).
> CI/automation-layer integration is out of scope — the stamper is a standalone
> deterministic CLI an automation layer will call later.

---

## 1. Purpose

Spare humans from reviewing PRs whose safety can be **checked mechanically**. An
author (human or LLM) writes a **waiver** — a declarative list of operations.
`waiver-stamp` can *apply* a waiver to produce code, and can *stamp* a PR — confirm,
**without AI, deterministically, fail-closed**, that the PR's diff is fully accounted
for by the waiver and that every operation's safety condition holds.

Pure refactors are one kind of safe change; others are bumping an internally-vetted
dependency and changing only test/doc files. The engine is general; refactors are
just the deepest operation family.

**Downside-bounded invariant.** The tool only ever *removes* review when it holds a
proof. No stamp → the PR gets today's normal human review. It never blocks, weakens,
or auto-rejects anything. Worst case = status quo.

Non-goal: proving semantic equivalence in general (undecidable). Trust comes from
**construction + reproduction + confinement**, never from inspecting arbitrary edits.

### 1.1 Trust posture — this is not a proof

**waiver-stamp does not produce an uncontestable proof of safety, and it is not meant
to.** Behaviour equivalence is undecidable in general, and every mechanism here has a
known blind spot:

- **introspection / dynamic references** the type system can't see — `obj[key]`,
  string-keyed DI or registries, reflection, references in non-TS files (JSON/SQL/
  templates);
- **transpiler-divergence constructs** where tsc's emit may differ from the project's
  deploy transpiler — decorator metadata, `const enum`, class fields, `namespace` /
  `import =` (guarded in §8, not proven);
- **confinement predicates** ("this file *is* a test") are heuristic;
- the **trusted runner and its toolchain** are themselves trusted, not verified.

So the goal is not an impossible guarantee but a **high practical bar**: make it very
difficult to get an unsafe change auto-approved *in a way useful to an attacker*, while
keeping common safe changes friction-free. Every gap is handled **fail-closed** (falls
to human review) and the system is **downside-bounded** (worst case = today's review). A
determined actor who authors the waiver can construct adversarial edge cases; the design
raises the cost of doing so *usefully*, and complements — does not replace — the normal
PR/review trust in contributors. Treat a stamp as "very likely safe and cheaply
re-verifiable," not as proof.

---

## 2. The safety model

A PR is stampable iff `waiver-stamp` can mechanically, deterministically, and
fail-closed **check** that it introduces **no un-reviewed change to production
behaviour** (in the practical sense of §1.1, not a formal proof). The two qualifiers
yield three operation **families**, processed in two **phases**:

| Family | Phase | Safety argument | How it's checked |
|---|---|---|---|
| **Reproductive ops** (`rename`, `move-file`, `extract-function`, `move-to-new-file`) | transform | provably cannot alter runtime behaviour | re-run on base; output matches head |
| **Confinement ops** (`change-test`, `change-docs`) | exclusion | provably cannot reach production | named files proven non-shipping; dropped from the comparison |
| **Dependency bumps** (standing policy — *no op*, §6.3) | compare | only pulls in code held to the same review bar | change fits the configured envelope; lockfile honestly re-resolves |

These are *different strengths of claim*. A reproductive op asserts "no behaviour
change." A **dependency bump explicitly *does* change behaviour** — its safety rests on
the *upstream* review of the bumped package, not on preservation — and, unlike the ops,
it is not written into the waiver at all: an allowlisted, up-moving bump is covered by a
standing per-repo policy (§6.3), the way formatting is covered by emit-invisibility (§7).
Keep that distinction explicit.

### Two phases

- **Transform ops** mutate the tree. They are **folded over `base` in order**, then
  the result is compared to head. They *are* order-sensitive (a `rename` before the
  `extract-function` that depends on it).
- **Exclusion ops** never touch the tree. They name files that, after a predicate
  check, are **removed from the comparison**. They are pure set-membership on the
  compare, so they are **order-independent** — among themselves and relative to
  transform ops. (This is why confinement ops need no "must go last" rule.)

---

## 3. Everything is an operation

There is no separate "category" or "ignore-list" concept. Each **operation** has a
**kind** from a closed vocabulary (the JSON Schema — §5), a **phase** (§2), and
**parameters**.

### 3.1 The stamping principle (the heart of validation)

A PR stamps iff **all** hold:

1. **Vocabulary gate** — every op is in the schema; else **FAIL closed**.
2. **Static guards** — per-op guards pass (§8).
3. **Fold** — apply the transform ops over a clean `base` checkout, in order → tree
   `O`. (Reproductive ops regenerate via the engine; there is no dependency op — bumps
   are handled by the standing policy at compare time, §6.3.)
4. **Exclusion** — for every exclusion op, predicate-check each named file (§6.2);
   any failure → **FAIL**. The union is the *excluded set*.
5. **Compare** — over every file **not** in the excluded set, the **compiler emit** of
   `O` must equal that of head (§7); non-TS assets compare by bytes, except
   `package.json` + lockfile, which are **covered** when the dependency-bump policy
   holds (§6.3). Any changed file neither reproduced by `O`, covered by the policy, nor
   excluded → **FAIL**. (Coverage is thus automatic — nothing extra can slip through.)
6. **Backstop (precondition)** — `tsc` clean and affected tests green on head. **Hard
   gate, always**, but **satisfied by the host CI's existing gate, not re-run by
   `waiver stamp`** — the automation layer confirms CI is green on the exact head SHA
   alongside the stamp (§14.4).

Fail anywhere → fall through to human review.

### 3.2 Composition & overlap

Because exclusion ops are comparison directives, mixed PRs and overlap are free:

- A refactor that also hand-edits tests is `[rename, change-test]`. The `rename`
  reproduces its production files; the test files are excluded and accepted from head.
- If the `rename` *also* propagated into an excluded test file, that's irrelevant —
  the file is excluded from the compare, so `O`'s version of it is never examined.
- A `rename` that *only* propagates into a test (no hand edit) needs **no**
  `change-test` op — it is reproduced, and `O` matches head for that file.

The safety asymmetry: a **production** file a reproductive op touched is stamped only
if `O` matches head there, so a stray hand edit makes it mismatch → FAIL. A
`change-test` op cannot rescue it, because a production file fails `change-test`'s
predicate (§6.2). **Soundness rests on the confinement predicate** (correctly
identifying non-shipping files), never on attribution.

**Excluded ≠ unchecked.** Excluded files are dropped from the *diff comparison* only;
they remain under the §3.1 backstop. If a `rename` propagated to a test and the
author's hand-edited head version still uses the old name, head won't compile → the
backstop FAILs.

### 3.3 The guaranteed-stamp property (intended workflow)

Because transform ops are *generated* by `apply`, an author can know a waiver will
stamp before pushing:

1. `waiver apply <waiver>` on base → produces the **production-code** changes;
2. hand-edit only the **test/doc** files;
3. push head = (apply output) + (hand edits); the waiver lists the transform ops + the
   `change-test`/`change-docs` exclusions.

Stamping then re-folds the same transform ops (matches head's production files by
construction), excludes the predicate-checked test/doc files, and passes. The author
never debugs a surprise stamp failure on the reproduced part; the only way the
exclusion path fails is if a file they believed was a test isn't (test-infra, or
imported by production) — an informative failure that caught real risk.

---

## 4. Architecture

**Two artifacts (one binary):**

The tool is **waiver-stamp**; its CLI binary is `waiver`.

- **Runner** — `waiver apply`: reads a waiver and applies its **transform** ops to the
  working tree, deterministically. (Exclusion ops describe hand-edits the author
  already made; `apply` does not generate those.) Built on **ts-morph** (substrate)
  with the TS compiler API as escape hatch.
- **Verifier** — `waiver verify`: reads a commit's embedded waiver and, against the
  commit's first parent vs the commit, runs the §3.1 stamping principle (fold +
  emit-compare + guards) and emits a PASS/FAIL JSON report; `waiver stamp` aggregates
  these per-commit verdicts over a PR range (§17.2). No separate trusted code — the
  verifier *is* the runner's verification mode. It does **not** run `tsc` or tests: the
  backstop (§3.1.6) is the host CI's existing gate, confirmed by the automation layer. So
  the tool's only deps are ts-morph, the package manager (for the dependency-bump policy,
  §6.3), and git.

The **op vocabulary** has a single source of truth: the **Zod schema**
(`src/schema.ts`). The TypeScript types are inferred from it and the **JSON Schema**
(`schema/waiver-stamp.v0.schema.json`) is *generated* from it (`pnpm gen:schema`, kept
honest by a drift-guard test). The generated JSON Schema still does triple duty —
LLM structured-output constraint, author lint, and the stamper's closed-vocabulary
gate — but it is a derived artifact, not a hand-authored one, so the types, the
validator, and the published schema can never drift from each other.

---

## 5. Waiver format

JSON, governed by a published JSON Schema.

```jsonc
{
  "schema": "waiver-stamp/v0",        // vocabulary/validation version
  "ops": [ /* ordered list; transform ops apply in order, exclusion ops are order-free */ ]
}
```

The header carries **only** what isn't already in the repo. TypeScript version, package
manager, and compiler options are **not** restated here — they live in the repo's
`package.json` / lockfile / `tsconfig` (a version-controlled, reviewed single source of
truth) and are read from the checked-out base/head. Restating them would risk a second,
divergent source. See §9 for how this grounds determinism.

### 5.1 Operation vocabulary (v0)

```jsonc
// ── Transform · reproductive (behaviour-preserving) ─────────────────
{ "op": "rename", "target": {Selector}, "to": "newName" }
{ "op": "extract-function", "target": {NodeLocator}, "name": "fnName" }
{ "op": "move-to-new-file", "symbols": ["A","B"], "from": "path", "to": "path" }
{ "op": "move-file", "from": "path", "to": "path" }

// ── Transform · tool-reproducible ───────────────────────────────────
{ "op": "lint-fix", "files": ["path", ...] }            // repo's own linter, safe fixes only

// ── Exclusion · confinement ─────────────────────────────────────────
{ "op": "change-test", "files": ["path", ...] }         // arbitrary edits; verified test files only
{ "op": "change-docs", "files": ["path", ...] }         // inert doc files the .waiver-stamp.json policy allows (§6.5)
```

There is **no `format` op and no comment op** — formatting-only and comment-only
changes are absorbed by the modulo-formatting-and-comments comparison (§7), so they
need no operation (an otherwise-empty waiver stamps them). `change-docs` therefore
covers only doc *files* (e.g. `*.md`); comment-only edits to source files require no
op at all. **`lint-fix` exists because not every lint fix is formatting**: fixes like
import sorting reorder emitted *statements*, which the token-exact comparison (§7)
rightly refuses to absorb — those need reproduction, not forgiveness.

**Dependency bumps likewise need no op:** an allowlisted, up-moving dependency change is
covered by a standing per-repo policy (§6.3), so it too stamps under an empty waiver —
the packages and versions are read straight from the `package.json` diff, not declared.

Optional same-family v0 add-ons (near-zero cost): `extract-constant`, `move-to-file`
(move *symbols* to an existing file — not to be confused with `move-file`, which
relocates a whole file).

### 5.2 Selectors

Symbol-resolved, never `line:col` (LLMs count badly; offsets drift across sequential
ops in the same file). Two selector kinds.

**`Selector` — a single declaration.** `file` + a `symbol` written as a **TSDoc
declaration reference**, resolved against the project's program via ts-morph:

```jsonc
{ "file": "...", "symbol": "topLevelName" }
{ "file": "...", "symbol": "ClassName.member" }
{ "file": "...", "symbol": "ClassName.(member:static)" }     // static vs instance
{ "file": "...", "symbol": "ClassName.(member:instance)" }
{ "file": "...", "symbol": "(ClassName:constructor)" }       // constructor
{ "file": "...", "symbol": "overloadedFn.(:2)" }             // zero-based overload index
{ "file": "...", "symbol": "(Shape:enum)" }                  // system selector for merged decls
```

Disambiguation (`:static` / `:instance` / `:constructor` / overload index / system
selectors) follows the TSDoc / API-Extractor declaration-reference grammar; resolution
must yield exactly one declaration, else the op fails.

**`NodeLocator` — a node or a contiguous sibling span.** Addresses any AST node —
statement **or expression** (the latter for `extract-constant`) — and is the target for
extract and future node-level ops:

```jsonc
{ "file": "...",
  "within": "<Selector symbol — the enclosing function/method>",
  "from":   { "text": "<unique normalized prefix>", "nth": 1 },  // nth optional (default: must be unique)
  "to":     { "text": "...", "nth": 1 } }                        // omit `to` for a single node
```

- **`within`** scopes the search to one body (reuses the TSDoc symbol grammar).
- **`from` / `to`** each resolve to exactly one node *within that body, across all
  nested blocks*. The author supplies `text` as a **verbatim snippet copied from the
  source** — no need to pre-normalize it. The resolver applies the **same
  normalization to both** the supplied `text` and each candidate node's source
  (comments stripped, whitespace collapsed, trailing `;` ignored), then matches when
  normalized `text` is a **prefix** of the normalized node. If more than one node
  matches, **`nth`** selects the occurrence in document order; if none matches or it
  stays ambiguous, the op **fails**.
- A **range** is `from..to` inclusive; the resolver requires they are **siblings in the
  same block** and `from` precedes `to`. A **single node** uses `from` only.

Completeness: any node is uniquely identified by (text, occurrence), and any range by
its first/last sibling — so `NodeLocator` expresses every supported edit with no
coordinates and no structural path. The enclosing block is derived (`from.parent`,
verified to contain `to`).

Resolution (both kinds) is ts-morph navigation against the loaded program, converted to
the `pos`/range the language service needs. Because a waiver is authored and stamped
against the **same pinned base**, every form is deterministic; the choice of
`text`/`nth` is for authoring ergonomics and auditability, not soundness.

---

## 6. Per-operation behaviour

### 6.1 Transform ops (folded over base, compared to head)

- **`rename`** → native `node.rename`. Renames symbol + all references *within the
  loaded program* (§8). Refuses on collision.
- **`extract-function`** → `getEditsForRefactor("Extract Symbol", action)` →
  `RefactorEditInfo.applyChanges()`; the LS names it `newFunction`, the runner then
  renames to `name` (determinism). Params are whatever the LS computes (so a param the
  extracted region doesn't use is dropped automatically). The dynamic `actionName`
  is resolved via raw `compilerObject.getApplicableRefactors` (documented escape
  hatch; narrowest enclosing scope; ambiguity → fail).
- **`move-to-new-file`** → `Move to a new file`; moves named top-level decls, rewires
  imports/exports; the LS adds `export` where cross-file refs require it.
- **`move-file`** → native `SourceFile#move`. Moves/renames a whole file and rewrites
  the module specifiers referencing it — static import/export declarations and dynamic
  `import()` arguments — *within the loaded program* (§8). Refuses when a source file
  already exists at the destination. Path references the LS can't rewrite
  (`require('./x')`, `jest.mock('./x')`, paths in config strings) are caught by the
  dynamic-reference guard (§8) — FAIL-closed.
- **`lint-fix`** → run the **repo's own committed lint toolchain** (the linter named in
  the checked-out manifest, at the lockfile-pinned version, with the committed config —
  e.g. `biome check --write`) over exactly the named files, applying **safe fixes
  only**. Folds **in order** like any other transform op; in practice it belongs
  **last**, after the ops whose output it cleans up (a `move-file` rewrites import
  specifiers, *then* the linter sorts them) — a misplaced `lint-fix` isn't unsafe,
  it just yields an `O` that doesn't match head and FAILs. Reproduction is the whole
  claim: `O`'s post-fix emit must equal head's, so a hand edit smuggled in alongside
  the lint fix still mismatches — which also means the op is safe on *any* file, not
  just ones other ops touched (a standalone repo-wide lint-fix commit is a legitimate
  waiver). This is **tool-reproducible, not engine-performed**: the
  transform is delegated to an external binary resolved from the commit's own
  dependency tree (§9). And it is **not strictly behaviour-preserving**:
  `organizeImports`-class fixes reorder **module evaluation order**. This is accepted
  by policy, not guarded — reordering is a property of the whole import sequence, so
  no per-import check can isolate a "dangerous" subset (a bare `import './x.js'`
  whose index is unchanged still has a different set of modules evaluated before it),
  and binding-only imports execute their modules too, carrying the same class of
  risk. In modern practice linters sort imports universally, so modules are written
  to be load-order-robust; the residual initialization-order edge (import cycles,
  module-scope registration racing another module's read) is documented here in the
  §1.1 spirit: a named, bounded acceptance rather than a silent one.

No reproduction. Each named file must pass its predicate; the global backstop (§3.1.6)
then covers behaviour.

- **`change-test`** — each file must be a **test file that does not ship**: in the
  project's test program (e.g. `tsconfig.spec.json`) and **not** in the production
  program. Production-program membership is the authoritative, self-maintaining shipping
  test (§14.3) — and it catches the leak case for free: a "test" file actually imported
  by production lands in the production program → not eligible → its hand-edit must be
  reproduced or it fails. Files that govern the test gate itself (`vitest.config.*`,
  setup files, CI yaml) are **never** eligible — the *backstop-integrity* exclusion —
  even though they're non-shipping. Content is accepted as-is — **including test
  weakening** (removed assertions): accepted by policy (no current production risk);
  residual erosion of the safety net is documented, not gated. The passing affected
  suite is part of the backstop.
- **`change-docs`** — each file must clear **both** gates:
  1. **Extension floor** — an inert text asset (`*.md`, `*.markdown`, `*.txt`). This
     is a hard floor a project policy can only narrow, never widen: it stops a
     shipping `.ts` (or any executable module) from being confined as a "doc" and
     thereby dropped from the compare. `*.mdx` is **excluded** — MDX compiles to
     JS/JSX, so it can reach production behaviour and fails the non-shipping premise.
  2. **Project policy** — the file is matched by `changeDocs.allow` and **not** by
     `changeDocs.deny` in the repo's `.waiver-stamp.json` (§6.5). Both lists are empty
     by default, so **a repo with no config confines nothing**: an AI-instruction asset
     like `.claude/**`, `CLAUDE.md`, `AGENTS.md`, or `.cursor/**` cannot be waived away
     without an explicit, reviewable allow entry — and `deny` is a hard veto over `allow`.

  The policy is read from **base** (§6.5), like `allowBumping` (§6.3) — a PR cannot widen
  it for itself. And because `.waiver-stamp.json` is itself a non-excludable, byte-compared
  file (§7), loosening the policy is always a visible, review-forcing diff.

A file named by an exclusion op that **fails** its predicate → FAIL (it is not
removed from the compare; a hand-edited production file then mismatches `O`).

### 6.3 Standing dependency-bump policy (no op)

Bumping an allowlisted dependency is a safe change, but — like formatting (§5.1) — it is
**not a waiver op**. There is nothing for an author to declare that the diff doesn't
already state: which packages moved, and to what, is read directly from the
`package.json` diff. So a dependency bump is covered by a **standing per-repo policy**,
evaluated during the compare (§3.1.5), the way emit-invisibility covers a reformat.

**Configuration — `.waiver-stamp.json` at the repo root, read from `base`.** A repo opts
in by committing:

```json
{ "allowBumping": ["@myorg/*", "lodash"] }
```

Entries ending in `/*` are **scope prefixes**; all others are **exact names**. The file
is read from the **base** checkout, so a PR cannot widen its own allowlist — the edit is
an un-covered file (→ review), and widening it requires a separately reviewed PR. **No
config (or an empty `allowBumping`) → the feature is off**: every `package.json`/lockfile
change falls to review. Nothing is auto-enabled.

**Coverage rule.** Within a stamped commit — one carrying a waiver, where an empty
`{ "ops": [] }` is enough — `package.json` + the lockfile are **covered** iff *all* hold;
otherwise they stay un-covered → the commit fails to stamp → review:

1. **Confined manifest diff** — base and head `package.json` are identical except within
   the dependency blocks (`dependencies`, `devDependencies`, `optionalDependencies`,
   `peerDependencies`). Any change to any other field (`scripts`, `pnpm`, `overrides`,
   `packageManager`, …) → not covered. Within those blocks the three kinds of change
   differ: an **addition** → not covered (adding is the supply-chain surface); a
   **removal** → covered for *any* package (removing pulls in nothing, so it needs no
   allowlist entry — step 5's re-resolve still guards any transitive churn); a **version
   change** → covered only under steps 2–4.
2. **Allowlisted** — every dependency whose version changed is on `allowBumping` and was
   already a dependency in base. (Removals need no allowlist entry; see step 1.)
3. **Plain-semver shape** — each changed version string is a plain semver version or
   range. Anything else (`npm:` aliases, `git:`/`file:`/`link:`/`catalog:`/`workspace:`
   protocols, tarball URLs) → not covered. This is an **allowlist of the good form**, not
   a blocklist of bad ones: the specifier grammar is package-manager-defined and
   open-ended, so only "is it plain semver?" is safe to decide.
4. **Up-moving only** — the head range must admit **no version below base's floor** (an
   exact pin, or a narrowing/superseding of base's range). A widening that re-admits
   lower or arbitrary versions (`^2.0.0 → ^2.0.0 || >=0.0.0`) is the smuggle vector → not
   covered.
5. **Honest lockfile** — adopt head's `package.json`, **re-resolve** the lockfile with
   the repo's package manager under **base's committed config**
   (`pnpm install --lockfile-only --ignore-scripts --prefer-frozen-lockfile`), and
   require the re-derived lockfile to **byte-match head's**.

Steps 1–4 are offline and deterministic; step 5 is the load-bearing one.

**Registry pinning is structural.** Re-resolution runs under base's committed
`.npmrc`/config, which the PR cannot alter (an `.npmrc` edit is an un-covered file → review;
a `pnpm`/`overrides` manifest edit trips step 1). So `@myorg/*` resolves through whatever
registry base pins — a same-named public scope cannot be substituted. Determinism and the
registry-drift residual are covered in §9.

### 6.4 Lockfile firewall (proposed)

> **Status: proposed — semantics under discussion, not in v0.** Full design (triage
> algorithm, rollout, open questions):
> `docs/superpowers/specs/2026-07-04-lockfile-firewall.md`.

§6.3's honest-lockfile check exists because CI's frozen install *trusts* the lockfile.
That trust is not specific to bumps — it holds on **every** PR — and the lockfile is the
one changed file **no human reviews**: thousands of generated lines, collapsed by
default. A frozen install verifies that the lockfile's *importers* match `package.json`
specifiers, then trusts the rest wholesale — the transitive graph and every
`resolution:` entry. The live poisoning shapes: swap a legit package's registry
resolution for a `tarball:` URL (`require('lodash')` now runs attacker code), or inject
phantom edges into a snapshot's dependency list. (Lying about *integrity* alone mostly
self-destructs — the registry serves the real tarball and the hash check fails the
install. The dangerous shapes are exactly the ones an honest re-resolution can never
emit.) So "falls to human review", the fail-closed backstop everywhere else in this
spec, is a real net for source files and a **fiction for this one**. Honesty must be
checked, not reviewed.

**The check.** Whenever the PR's **net base→head diff** touches the lockfile or any of
its inputs — waiver or no waiver: stage base's lockfile plus **head's visible inputs**
(`package.json`, `.npmrc`, `pnpm-workspace.yaml`, patches), re-resolve with the pinned
package manager (§6.3 step 5's invocation), and require the result to **byte-match**
head's lockfile. What byte-match proves: *the lockfile is exactly the derivation of
files a reviewer can actually read.* Unlike §6.3 the staging takes **head's** config —
an arbitrary PR may legitimately change `.npmrc` or workspace config, and a registry
redirect through those files is a small, visible, reviewable diff. The firewall closes
the invisible channel; the visible ones stay review's job.

**Net diff, not per-commit.** Intermediate lockfile states inside a PR are installed by
no one; only the merged result ships. Per-commit checking would veto the routine "fix
the lockfile in a follow-up commit" pattern for no security gain.

**Verdict semantics — a deliberate contract change.** Today only a commit that *claims*
a waiver can produce REQUEST_CHANGES (§17.2); unwaivered commits are ABSTAIN material.
The firewall is the first check that can flag a commit which never opted in — the stamp
becomes a gate as well as an approver. That posture is per-repo configuration in
`.waiver-stamp.json` (read from **base**, like `allowBumping`):
`"lockfileFirewall": "off" | "warn" | "enforce"`, default **off**. `warn` → a mismatch
caps the PR verdict at **COMMENT** (never APPROVE) with the finding attached; `enforce`
→ **REQUEST_CHANGES**.

**Tamper vs drift — triage before veto.** A byte-mismatch conflates two populations:
**tampering** (the lockfile contains what re-resolution cannot derive) and honest
**registry drift** (§9 — the registry moved between author time and stamp time). On
mismatch the firewall validates each disagreeing entry against the registry directly:
integrity equality for the exact `name@version` (time-invariant, unlike "highest
satisfying now"), resolution shapes declared by some manifest, graph edges consistent
with the real packages' own manifests, ranges satisfied. All-honest → **drift** →
warn-tier outcome plus refresh guidance (and the same classification softens a §6.3
step-5 failure from bare `invalid` to "drift — refresh"). Anything else → **tamper** →
REQUEST_CHANGES naming the entry — proposed to apply at every knob level including
`warn` (a detected attack should not be a comment; open question in the design doc).
The residual the drift class tolerates — an attacker *choosing* among real,
range-satisfying versions (e.g. pinning a vulnerable one) — is bounded by §6.3's
up-moving gate on the auto-approve path and accepted (§1.1) on the review path, where
the manifest diff is visible anyway.

**Relation to §6.3.** The bump policy's step 5 *is* this check under stricter staging —
base's config, which coincides with head's whenever the bump is covered (a config edit
is an un-covered file) — plus gates 1–4. One evaluator serves both: the policy is the
auto-approve envelope; the firewall is the always-on honesty gate.

**Residuals.** The firewall does not vet what the registry *serves* (upstream trust
stays with `allowBumping` and review of manifest diffs). Enablement trusts the existing
lockfile as its induction base (the triage machinery doubles as an optional one-time
baseline audit). v1 is pnpm-only; npm's `package-lock.json` — whose in-lockfile
`resolved` URLs are the classic injection surface — is the natural next target (§13).

### 6.5 `change-docs` policy — `.waiver-stamp.json`

The `change-docs` confinement policy lives alongside the bump policy (§6.3) in
`.waiver-stamp.json` at the repo root, under a `changeDocs` key:

```json
{
  "changeDocs": {
    "allow": ["docs/**", "**/README.md", "CHANGELOG.md"],
    "deny": [".claude/**", "**/CLAUDE.md", "**/AGENTS.md", ".cursor/**"]
  }
}
```

- Both keys are gitignore-style glob lists over **repo-relative posix paths**, matched
  with `picomatch` (`dot: true`, so leading-dot paths match).
- Both default to `[]`. Empty `allow` ⇒ **nothing** is confinable — the safe default.
- `deny` is a hard veto: `allow ∧ ¬deny`.
- The policy only narrows the extension floor (§6.2); it can never widen `change-docs`
  to executable files.
- Read from **base**, like `allowBumping` (§6.3) — a PR cannot widen it for itself.
  Belt-and-suspenders, a `.waiver-stamp.json` edit is itself a non-excludable,
  byte-compared file (§7), so loosening the policy is a review-forcing diff.
- A missing file yields the empty policy. Malformed JSON or an unknown key inside
  `changeDocs` **fails closed** — the stamp fails with a `WaiverConfigError`.

---

## 7. Comparison — by compiler emit

The compare (§3.1.5) is over the **compiler's emit**, not the typed AST. For each file,
emit `O` and head through the project's program (ts-morph `getEmitOutput()` /
`emitToMemory()` — i.e. type-directed tsc emit) and compare the emitted JS modulo
whitespace. The emit *is* what runs, so equal emit ⟹ equal runtime behaviour — this is
the behaviour-preservation claim, measured rigorously rather than approximated.

This single definition:

- **Erases all type-only constructs** — annotations, interfaces, type aliases, generics,
  `as`/`satisfies`/`!`, overload signatures. So type-only edits (extract or rename a
  type, add/adjust annotations, add an interface) are **free**: they emit identically
  and stamp with an empty or minimal waiver. (This is what lets a hand-added named
  return interface alongside an extracted function pass.)
- **Correctly keeps the constructs that only *look* type-level but emit code** —
  non-`const` enums, parameter properties, decorators (incl. `emitDecoratorMetadata`,
  where a type annotation *does* reach runtime), const-enum inlining — because tsc
  decides what's erased, not us. (This is why we emit through the **program**, not
  `transpileModule`, which is type-unaware and would miss these.)
- **Subsumes formatting and comments** — emit is canonically formatted and
  comment-stripped, replacing the old "modulo formatting/comments" rule and removing any
  need for `format`/comment ops (formatting-, comment-, and type-only diffs are invisible
  → stamp with an empty or minimal waiver).
- **Largely dissolves the directive-comment problem** — `@ts-ignore`, `@ts-expect-error`,
  `eslint-disable`, etc. are comments, absent from emit; their only effect is on
  type-checking/lint, already covered by the backstop (§3.1.6).

**Policy consequence — type weakening.** Because emit ignores types, a type *weakening*
(e.g. `: string` → `: any`) emits identically and still type-checks, so it stamps.
Runtime-safe, but it erodes the type safety net — accepted by policy, mirroring the
test-weakening stance (§6.2); noted, not gated.

**Reference transpiler.** The emit is produced by **tsc** (via the loaded program) by
default; it is configurable per project (e.g. point at the deploy transpiler for
exactness). tsc-equivalence implies deploy-equivalence for everything except the
handful of constructs transpilers erase differently — those are caught by the
emit-divergence guard (§8), not assumed away. Only the **files whose source differs**
between `O` and head need emitting (byte-identical files are trivially equal), so the
cost is a few files, not the tree.

Emit depends on compiler options (target, module, decorator/enum settings), so those are
pinned in the determinism contract (§9).

---

## 8. Static guards (engine-vouched ≠ globally safe)

Guards close the gaps the loaded program can't see (apply to **reproductive** ops):

- **Single-project (v0).** Reproductive symbol ops operate within one Nx project's
  `tsconfig` program. Guard: every reference of every targeted symbol lies inside the
  loaded program; a consumer in another Nx project → **FAIL** (→ later). Not a
  whole-engine limit — `change-test`/`change-docs` and the dependency-bump policy (§6.3)
  aren't project-scoped.
- **Public-API guard.** **FAIL** if a reproductive op targets a symbol exported from a
  published surface — `libs/*-sdk` / `libs/*-api-contract` public `index.ts`
  (cross-repo consumers invisible to the program). With single-project, v0 refactors
  are **app-internal only**.
- **Dynamic-reference scan.** Heuristic scan of targeted symbols for forms the LS
  can't track: `obj["name"]`, string-keyed DI/registry tokens, references in non-TS
  sibling files (JSON/SQL/templates). A rename can slip past structural retargeting in
  **two directions**, so the scan runs on both sides of the commit: the **old** name in
  **head** (a `'oldName'` string that survives the rename now resolves to nothing —
  scanning head, not base, lets a commit that also edits the string away clear the
  guard), and the **new** name in **base** (a pre-existing `'newName'` string the
  freshly-introduced symbol would silently capture). Either hit → **FAIL** (the "modulo
  introspection" caveat, operationalised). Files confined by `change-test`/`change-docs`
  are skipped on both sides — already out of the comparison, they can't smuggle a
  production change. For `move-file`, the path analogue, same two directions: a string
  literal resolving to the **old** path in **head** (stale) or to the **destination**
  path in **base** (captured), counting only forms the LS won't rewrite — not static
  import/export specifiers or dynamic `import()` arguments, but `require('./x')`,
  `jest.mock('./x')`, paths in config strings. Either hit → **FAIL**.
- **Emit-divergence guard.** The emit comparison (§7) uses tsc; tsc-equivalence implies
  deploy-equivalence except for constructs transpilers erase differently —
  **decorator metadata (`emitDecoratorMetadata`), `const enum`, class fields
  (`useDefineForClassFields`), `namespace` / `import =`**. If a source difference
  between `O` and head touches one of these, **FAIL** (→ review). (This is the
  enumerated-edge-case trade from §1.1: a short, stable list, fail-closed.)

  **Accepted shortcoming — parameter properties.** Constructor parameter properties
  (`constructor(readonly x: number)`) are synthesis rather than erasure, so in
  principle they belong on the list: tsc's emit collapses a parameter property and a
  hand-written field-plus-assignment into the same tokens, so the stamp relies on the
  deploy transpiler treating both spellings identically. In practice every mainstream
  transpiler (esbuild, swc, Babel's TS transform) compiles them exactly as tsc does —
  an assignment after `super()`, set semantics — and flagging them rejects any change
  to a file with error-class-style constructors, which is far too noisy for the
  marginal risk. The guard therefore does **not** flag them; this is a known,
  deliberate gap in the enumeration. The sound future fix is not re-adding the check
  but running the §7 emit comparison under the **repository's own CI/CD transpiler**
  (the configurability §7 already anticipates): when the reference emitter is the
  tool that builds the shipped artifact, equal emit directly means an unchanged
  artifact, and the whole tsc-vs-deploy enumeration — this gap included — dissolves.

> The v0 reproductive path targets **app-internal, single-project, non-lib** refactors —
> the common case for everyday refactor PRs.

---

## 9. Determinism

`stamp`'s re-fold/re-resolution must be bit-reproducible. Determinism rests on the repo's
committed toolchain, not on values copied into the waiver:
- **The repo's committed toolchain** — TypeScript version (lockfile), `tsconfig`
  compiler options, and package manager are read from the checked-out base/head. Both
  `apply` and `stamp` see the same committed config, so they stay consistent with no
  header entry to drift. The tool emits using the **repo's** TypeScript + `tsconfig`
  (not its own bundled TS) so emit matches the repo's build semantics.

Given those, the rest is mechanical:
- Extract's generated name is immediately renamed to the authored name.
- `getApplicableRefactors` action selection uses a documented deterministic rule.
- Comparison is by **compiler emit** (§7), canonically formatted and deterministic given
  the repo's options, so formatter drift is irrelevant.
- Dependency-bump coverage (§6.3) re-resolves the lockfile with the repo's package
  manager (`pnpm install --lockfile-only --ignore-scripts --prefer-frozen-lockfile`) from
  base's manifest, lockfile, and committed config. Re-resolution keeps every
  already-locked dependency pinned and re-derives only the bumped subtree, so it is
  deterministic given registry state. The residual is **registry drift**: a
  newly-introduced transitive edge whose range floats can resolve to a later version at
  stamp time than at author time — so a commit that stamps today can fail to re-stamp
  later. This is narrow (new edges only), **fail-closed** (drift → byte mismatch →
  review, never a false stamp), and the same bounded acceptance §1.1 makes elsewhere;
  `--prefer-frozen-lockfile` shrinks it to its minimum. The proposed lockfile firewall
  (§6.4) inherits exactly this residual over a wider trigger surface; its triage tier
  classifies drift apart from tampering rather than eliminating it.
- `lint-fix` adds a **new assumption class**: that the external lint binary is
  deterministic given its pinned version (lockfile) and committed config. True in
  practice for Biome/ESLint safe fixes, but unlike the AST ops the engine performs
  itself, this determinism is *assumed of a third-party tool*, not owned by the
  engine. The assumption is bounded the same way the dependency-bump policy (§6.3) bounds
  registry trust: the
  tool identity and version come from the commit's own dependency tree, so a stamp
  never depends on anything the reviewer of the lockfile didn't already admit. If the
  tool proves non-deterministic, `O` ≠ head → mismatch → review: non-determinism
  degrades to a false FAIL, never a false stamp.
- No wall-clock / randomness anywhere.

---

## 10. CLI & report

```
waiver apply <waiver>                            # apply transform ops to the working tree
waiver verify [<commit>] [--json]                # verify one commit (default HEAD)
waiver stamp  --base <ref> --head <ref> [--json] # aggregate the PR verdict over base..head
```

`apply` takes a waiver **file**; `verify` and `stamp` take a **commit / range** and read
each commit's **embedded** ` ```waiver ` block (§17.1) — the waiver travels with the
change, so there is no waiver-file argument at check time. `apply` is the only file-taking
command; there is no separate `check` (its schema/guard job is subsumed by `apply` and
`verify`, §17.4).

- **`apply`** exit: `0` applied · `1` op-application failure · `2` malformed waiver file
  · `3` internal.
- **`verify [<commit>]`** (default `HEAD`) applies the §3.1 stamping principle to a
  single commit, folding its embedded waiver over the commit's first parent. A merge or
  root commit is **skipped** (§17.1). Exit: `0` the commit is **stamped** or **skipped**
  · `1` **invalid** (embedded waiver present but fails) or **unwaivered** (no block) · `2`
  malformed invocation (unresolvable commit-ish) · `3` internal.
- **`stamp --base --head`** walks `base..head`, verifies each commit, and emits the
  aggregate PR verdict (§17.2). Exit: `0` verdict ∈ {APPROVE, COMMENT, ABSTAIN} · `1`
  REQUEST_CHANGES · `2` malformed invocation · `3` internal.

`--json` emits the machine report (§17.3) — per-commit findings and, for `stamp`, the
aggregate verdict — the seam for the CI/automation layer.

---

## 11. Worked examples

| Change | Waiver ops | Verdict |
|---|---|---|
| share a helper between two callers | `extract-function` ×2 | Stamps (added JSDoc = comments → invisible). |
| extract a shared module to a new file | `move-to-new-file` + `extract-function` ×2 | Stamps: a hand-added named return interface is type-only → erased from emit → invisible to the compare (§7). |
| change a string constant's value | — | Out of scope: string-value change, not behaviour-preserving; nothing reproduces it → mismatch → review. |
| refactor + hand-edited tests | `[rename, change-test]` | Stamps: `rename` reproduces source; test files excluded + predicate-passed; suite green. |
| relocate a file into a subdirectory | `[move-file]` | Stamps: the move rewrites every static import/export and dynamic `import()` specifier; a `require('./x')` or `jest.mock` path → dynamic-reference guard → review. |
| internal lib bump | `[]` (empty waiver) | Stamps: the dependency-bump policy (§6.3) covers manifest+lockfile — allowlisted, up-moving, lockfile re-resolves to head. No op. |
| README typo / reformat | `[]` or `[change-docs]` | Source reformat/comment-only → empty waiver. Any `*.md` content edit → `change-docs` (doc bytes are compared as-is, so even a typo fix is visible), if `changeDocs.allow` covers the path (§6.5). |

---

## 12. Out of scope (v0)

- Multi-Nx-project / cross-repo reproductive coverage (→ later).
- Ops beyond §5.1: `inline-variable`, `extract-type`, convert-family, `revert`,
  codegen-regeneration (→ later).
- An additive `add-export` op (widening export visibility on its own) (→ later).
  (JSDoc and type-only declarations need no op — they're erased from emit, §7.)
- Custom (non-LS) reproductive ops (e.g. hand-rolled `inline-function`) — lower trust
  tier requiring the §3.1 backstop as a hard gate (→ later).
- CI/automation-layer integration (`stamp --json` is the seam).

---

## 13. Roadmap

**v0 — single-project; transform + exclusion ops + the dependency-bump policy.**
Ops: `rename`, `extract-function`, `move-to-new-file`, `move-file` (reproductive);
`change-test`, `change-docs` (confinement). Plus the standing **dependency-bump policy**
(§6.3, no op). Reproductive ops single-project + app-internal (§8). Stamping principle,
fold + emit compare (§7) + exclusions, static guards, JSON report. Covers the extract /
share / module-extraction cases plus test-only / docs-only / bump / mixed (§11).

**Later.**
- Multi-project reproductive ops: Nx project-graph-aware program set covering all
  dependents; rename/move across project boundaries; relax the single-project guard to
  "all consumers covered"; principled `libs/*` handling (public-API guard → cross-repo
  *impact report* where downstream repos are inspectable).
- More reproductive ops: `inline-variable`, `extract-type`, convert-family, `revert`,
  codegen-regeneration.
- `lint-fix` (tool-reproducible, §5.1/§6.1): fold the repo's own pinned linter's safe
  fixes over the transformed base; import reordering accepted by policy (§6.1). Spec'd,
  not yet implemented; motivated by dogfooding — a `move-file` sweep leaves rewritten
  import specifiers unsorted, and the follow-up `organizeImports` fix is not
  emit-neutral, so today it needs a separate reviewed commit.
- An additive `add-export` op, if widening export visibility on its own proves common
  (other additive type/JSDoc edits already pass for free under emit comparison, §7).
- Custom non-LS ops with mandatory tsc+tests gating.
- Dependency-bump policy breadth (§6.3): npm/yarn support, workspaces/multi-manifest, a
  per-package version ceiling (`maxBump`), and an explicit per-package required-registry
  cross-check (natural on npm's JSON lockfile, which records `resolved` URLs). Plus
  cross-repo released-artifact verification.
- **Lockfile firewall (§6.4, proposed):** always-on honest-lockfile check over the net
  PR diff — staged from head's visible inputs, byte-compared, config-gated
  (`lockfileFirewall: off | warn | enforce`) — with a registry-truth triage tier
  separating tamper (veto) from drift (warn + refresh guidance). pnpm first; npm's
  `resolved`-URL lockfile next. Design:
  `docs/superpowers/specs/2026-07-04-lockfile-firewall.md`.
- Extend the token-economy benchmark (§19) with a `move-file` task (relocate a
  widely-imported file and rewire its importers) and regenerate the README table
  from a real `pnpm bench` run.
- Publish a JSON Schema for `.waiver-stamp.json` (§6.3, §6.5) — generated from the Zod
  config schema and drift-guarded by a test, the same way the waiver schema is —
  so editors can validate the config file (today it is validated only at runtime).

---

## 14. Decisions

1. **Runner distribution — own repo.** `waiver-stamp` lives in its own repo. Its own
   trustworthiness is accepted per §1.1 (trusted, not verified) — we don't over-engineer
   vouching for the tool itself.
2. **Dependency bumps — a standing per-repo policy, not an op (§6.3).** A committed
   `.waiver-stamp.json` lists allowed packages under `allowBumping` (`@myorg/*` scope
   prefixes or exact names), read from **base** so a PR can't widen it for itself; absent
   → the feature is off. Changes must be confined to the dependency blocks: a covered
   **version change** must be allowlisted, plain-semver-shaped, and **up-moving** (head
   admits no version below base's floor); a **removal** is covered for any package (it
   pulls in nothing); an **addition** is never covered. In every case the lockfile must
   **honestly re-resolve** to head's bytes — the check CI's
   frozen install does *not* perform. Registry pinning is structural (re-resolution under
   base's committed config, which the PR can't alter). A per-package version ceiling
   (`maxBump`) is roadmap; v0's trust is upstream review, not a version bound.
   (Supersedes the earlier "central allowlist baked into the runner" design: per-repo
   config keeps the tool repo-agnostic and the review boundary local, and making it a
   standing policy rather than an op removes ceremony the diff already carried.)
3. **Shipping classification from the production tsconfig.** A TS file is non-shipping
   (eligible for `change-test`) iff it is **not in the production build's program** —
   authoritative and self-maintaining (it *is* the project's build config), and it
   catches "test file imported by production" for free (imports override `exclude`, so
   such a file is in the production program → classified shipping → its hand-edit must be
   reproduced or it fails). Separate from shipping, a short **backstop-integrity**
   exclusion bars `change-test` from files that govern the test gate (`vitest.config.*`,
   setup, CI yaml), even though they're non-shipping.
4. **Backstop is always a hard gate — but reuses existing CI, not re-run by the tool.**
   `tsc` clean + affected tests green on head is required for every stamp, not advisory.
   It is **not executed by `waiver stamp`**: it's a property of `head` that the host CI
   already establishes (and already gates merges on), so the automation layer confirms CI
   is green on the exact head SHA alongside the stamp. This avoids duplicating the
   expensive run and keeps the tool free of per-project test-runner integration (its
   only deps are ts-morph, the package manager, and git). On pure-reproductive PRs the
   backstop also doubles as a net for the introspection blind spots of §1.1 (e.g. a
   rename that silently broke a dynamic reference). Caveats for the automation layer:
   the CI result must be on the *exact* stamped head SHA, and affected-test selection
   must cover the change (`nx affected` on the PR does).

---

## 15. Design decisions & rejected alternatives

The §14 items are settled config knobs; this section records the larger design choices
and the alternatives we rejected, so the rationale isn't lost.

### Substrate & tooling
- **Build on `ts-morph`** (with the raw TS compiler API reachable via `.compilerObject`
  for what it doesn't wrap, e.g. `getApplicableRefactors`).
  - *Rejected — Serena:* LLM-agent-driven and stateful, not a deterministic batch
    engine; only `rename` fits, no extract/move.
  - *Rejected — OpenRewrite (for TS):* its TS recipe catalog has no extract/move/inline;
    closed-source repos need a paid Moderne license; JVM + Node-sidecar; TS support is
    young. We **borrow its model** (declarative recipes + provenance + determinism) as
    the blueprint, but not the engine.
  - *Rejected — raw TS compiler API / language service:* ts-morph already manages the
    `LanguageServiceHost`, in-memory FS, program lifecycle, and edit application. Raw
    only wins *inside* a tsserver plugin, which the standalone runner is not.

### Operations
- **Vocabulary tracks what the TS language service actually provides** (verified against
  TS 6.0 / ts-morph 28): `rename` (native), Extract Symbol → function/constant, Move to
  (new) file, `inline-variable`.
  - **`inline-function` does not exist** in tsserver → excluded. Hand-rolling it is a
    later tier-B custom op; upstreaming is slow/uncertain (issue #27070 open since 2018;
    PR #29096 closed unmerged).
- **No `format` or comment ops** — formatting- and comment-only diffs are invisible to
  emit comparison (§7), so they need no operation.

### Format & selectors
- **Waiver = JSON governed by a JSON Schema.** *Rejected JSON5/JSONC:* the comment/
  readability gain wasn't worth diverging from strict JSON (which keeps constrained
  LLM decoding trivial; a schema would be needed regardless). The schema does triple
  duty: LLM structured-output constraint, author lint, closed-vocabulary gate.
- **Schema authored in Zod, JSON Schema generated from it.** *Rejected hand-writing the
  JSON Schema alongside the TS types:* that's two sources for one vocabulary and they
  drift. Zod (`src/schema.ts`) is the single source — types via `z.infer`, the published
  JSON Schema via `z.toJSONSchema()`, runtime validation via `safeParse` (so no separate
  validator dependency). A drift-guard test asserts the committed JSON Schema equals the
  generated output. LLMs still consume the generated **JSON Schema** (never Zod), so the
  authoring/constraint story is unchanged. Uses `zod@3.25` via the `zod/v4` bridge.
- **Header carries only `schema`; the toolchain comes from the repo.**
  *Rejected restating TypeScript/package-manager/compiler-options in the waiver:* they're
  already pinned by the base commit's `package.json`/lockfile/`tsconfig`, so a waiver copy
  would be redundant and could drift — and emit must use the *repo's* TypeScript +
  `tsconfig` to match its build semantics, so a disagreeing waiver value would be a bug.
  The stamper reads the toolchain from the checked-out base/head (§9); `ts-morph` is the
  tool's own dependency.
- **Symbol selectors = TSDoc declaration references** (full, from v0).
  - *Rejected `line:col`:* LLMs count lines/columns badly, and offsets drift across
    sequential ops in a file.
  - *Rejected SCIP for v0:* carries package/registry/version — overkill when the
    selector is already file-scoped. Keep SCIP as the **multi-project** identity scheme
    for later.
- **Range/node selectors = `{within, from, to}`** with a unique normalized-text prefix +
  optional `nth`; unified over statements **and** expressions; **no structural path**.
  Normalization is symmetric — the author pastes a verbatim snippet; the resolver
  normalizes both sides. Fail-on-ambiguity.

### Model & comparison
- **Hybrid model — recipe of transform ops + exclusion ops.** *Rejected pure-generative*
  (every op, incl. tests/docs, carries full content): self-contained but fat and
  redundant with the PR. *Rejected the original "claims + coverage-attribution" model:*
  exclusion ops are **comparison directives, order-independent** (not take-from-head
  transforms). Coverage = every changed file vouched by ≥1 op; **confinement subsumes**
  a reproductive op's spill into the same file.
- **Compare by compiler emit (tsc, type-directed), modulo whitespace** (§7).
  - *Rejected typed-AST / hand-stripping type nodes:* fragile (must enumerate every
    runtime-affecting "type-ish" construct). tsc erases correctly by construction.
  - *Rejected `dist`/build-output comparison:* blind to runtime-loaded assets (e.g. a
    template read via `fs.readFileSync` ships but isn't in JS `dist`), needs reproducible
    builds, and costs a full build ×2. Possible later *high-assurance backend* for the
    bundled portion, never the sole check.
  - tsc is the **default reference transpiler, configurable**; the tsc-vs-deploy gap is
    closed by the **emit-divergence guard** (a short, stable enumerated set), per the
    explicit choice to *trust an enumeration* (Option A) over running two transpilers.
- **Trust posture: not a proof (§1.1).** The goal is to make a *useful* hack very hard,
  fail-closed everywhere, downside-bounded — not an uncontestable guarantee.

### Scope & policy
- **v0 = single Nx project, app-internal** (reproductive ops); multi-project → later.
- **General tool, not project-specific:** project surfaces (production/test tsconfig,
  published-package paths, dependency-bump allowlist (`allowBumping`, §6.3), reference
  transpiler) are **configuration**;
  the §11 worked examples are generic scenarios, not tied to any repo.
- **Accept test-weakening and type-weakening** — runtime-safe; future-safety erosion is
  noted, not gated (mirrors each other).
- **Composition from day 0** via `change-test` + the order-independent exclusion model.
- **Boundary case:** a PR *labelled* "rename" that only changes a string-literal *value*
  is **out of scope** — not a symbol op and not behaviour-preserving; no op reproduces
  it, so it falls to review.

---

## 16. The paramount feature — LLM-authored refactors

> Everything in §§1–15 describes a *checker*. This section names what the checker is
> **for**: making it cheap, safe, and near-effortless for an **LLM** to land a refactor.
> This is the project's reason to exist; the engine is in service of it.

A large fraction of the diff an LLM produces during a refactor is **mechanical
expansion** — rename one symbol, edit its 30 call sites; extract one function, rewire
its references. The LLM spends output tokens (and makes mistakes) re-deriving edits that
a language service computes deterministically. waiver-stamp inverts this: the LLM writes
the **intent** (a tiny waiver — "rename `fooBar`→`bazQux`"), the deterministic runner
performs the **expansion** (`waiver apply`), and the same runner later **re-derives and
checks** that expansion against the PR (`waiver stamp`). The LLM never hand-edits the
mechanical part, so it cannot get it subtly wrong, and the reviewer never reads it,
because it is mechanically vouched.

**The authoring loop (the feature):**

1. The LLM (guided by the **skill**, §18.2) inspects the code and writes a v0 waiver —
   a handful of ops, symbol-selected (§5.2), no `line:col`.
2. It calls **`waiver apply`** (via the CLI or the **MCP tool**, §18.1). The runner
   produces the production-code diff deterministically.
3. It commits with the **waiver embedded in the commit message** (§17). One commit = one
   atomic, self-certifying refactor step.
4. On push, **`waiver stamp`** (§17.2) verifies each commit's embedded waiver and
   aggregates the PR verdict (the author can run **`waiver verify`** on a single commit
   locally first, §17.4). A correctly authored waiver stamps **by construction** (§3.3) —
   the LLM never debugs a surprise stamp failure on the reproduced part.

**Two measurable wins (§19 publishes both; §20 leads with the second):**

1. **Authoring tokens** — writing the intent costs *O(intent)* output tokens; hand-editing
   costs *O(diff)*. This is the number the project was asked to produce. It is **real but
   conditional**: a wrong selector costs a `waiver_apply` round-trip and a rewrite, so the
   honest metric *includes the validation/retry loop* (§19), and the win **grows with
   mechanical fan-out** — a 30-reference rename wins big; a one-call extract may be a wash.
   The skill (§18.2) exists precisely to keep selector authoring on the happy path.
2. **Review tokens** — the larger, more honest win. A stamped commit is re-verified
   *mechanically* (≈0 LLM tokens); an un-waivered refactor must be read line-for-line by a
   human or an LLM reviewer (*O(diff)* again, and exactly the diff a tired reviewer skims).
   "Reviewer never reads the mechanical part" is the product win; authoring savings are the
   secondary one.

The safety story (§§1–15) is what makes the cheap path also the *trusted* path — without
the mechanical re-check, a cheap LLM-authored refactor would still need a full human read.

**Authoring is not free, and the spec says so.** Selectors (§5.2) are fiddly —
overload indices, `:static`/`:instance`, `NodeLocator` text/`nth`. The break-even fan-out
below which hand-editing is competitive is **measured, not hidden** (§19), and the failure
mode (selector iteration) is taught against in the skill, not pretended away.

---

## 17. Commit-embedded waivers & per-commit PR verification

`apply` takes a waiver **file**, but the LLM-authoring path (§16) needs the waiver to
**travel with the change** at verification time. So the unit of certification is the
**commit**, not a side-car file: `verify`/`stamp` read the waiver from the commit's
embedded ` ```waiver ` block rather than from a path.

### 17.1 The commit-embedded waiver format

A refactor commit carries its waiver as a **fenced ` ```waiver ` block** in the commit
message body:

````text
refactor: rename calculateTotal to computeTotal

Pure rename across the orders module; no behaviour change.

```waiver
{
  "schema": "waiver-stamp/v0",
  "ops": [
    { "op": "rename",
      "target": { "file": "src/orders.ts", "symbol": "calculateTotal" },
      "to": "computeTotal" }
  ]
}
```
````

- **Parsing algorithm (pinned, fail-closed).** `verify` reads the **full** message via
  `git log --format=%B` (never the truncated subject). It scans for **every** fenced
  ` ```waiver … ``` ` block (info-string exactly `waiver`) and parses each as JSON. The
  block is **self-identifying by its fence** — no need to sniff unrelated ` ```json `
  blocks — and its root `schema` must still equal `"waiver-stamp/v0"` **exactly** (string
  equality, not prefix/substring — the §5 Zod literal is the authority; a ` ```waiver `
  block whose `schema` differs or is absent is a present-but-broken claim). Then:
  - **0 waiver blocks** → the commit is **unwaivered**.
  - **exactly 1 waiver block** → the commit is **waivered**; it must pass full schema
    validation (§5) and stamping (§3.1). A block that fails to parse or validate is
    **invalid** (§17.3), never silently dropped. Incidental ` ```json ` (or other) fences
    are ignored by construction — they are not ` ```waiver ` blocks.
  - **≥2 waiver blocks** → **invalid** (a commit is one atomic step). Because selection is
    by the ` ```waiver ` fence, the old "decoy-first-block" attack (hiding the real waiver
    behind a decoy json block) does not arise.
- **Robustness rules.** The block is matched tolerant of trailing whitespace and CRLF;
  the embedded JSON **may not itself contain a ` ``` ` fence** (the §5 schema forbids
  triple-backticks in string values, so the fence is always unambiguous). An embedded
  waiver larger than **64 KiB** is **invalid** (DoS guard; real waivers are a few ops).
- **The commit *is* the base/head pair.** Stamping a waivered commit `C` runs the §3.1
  principle with `base = C^1` (git **first parent**) and `head = C`. The waiver must fully
  account for `C`'s entire diff (§3.1.5 coverage) — a waivered commit may **not** smuggle an
  un-accounted change. **Merge commits** (≥2 parents) are **skipped** with a recorded reason
  (`merge-commit`): they synthesise multiple branches and cannot be a single atomic step.
  Every non-merge commit is verified against its own first parent, whether or not that
  parent lies inside `base..head` — there is no out-of-range skip.
- **Stacking is supported and well-defined.** A multi-step refactor is a *sequence* of
  waivered commits; each stamps against its own parent, and because earlier commits are
  already in the tree, later commits that depend on them stamp correctly. `stamp` walks the
  range in order (verifying each commit). (Example: commit 1 renames a private helper;
  commit 2 renames the public API that now uses it — both stamp.)

### 17.2 `waiver verify` (one commit) and `waiver stamp` (the PR)

Two commands over the same engine — a single-commit primitive and its range
aggregation:

```
waiver verify [<commit>] [--json]                # default HEAD — classify one commit
waiver stamp  --base <ref> --head <ref> [--json] # aggregate the verdict over base..head
```

**`waiver verify [<commit>]`** reads the commit's embedded ` ```waiver ` block (§17.1),
folds `commit^..commit` through the §3.1 principle, and classifies the commit as
**stamped** / **invalid** / **unwaivered** (table below). It is the author's local
check: run it on `HEAD` right after committing and a failed claim surfaces immediately,
not at review time. A **merge commit** (≥2 parents) or a **root commit** (no parent) is
reported **skipped** (`merge-commit` / `root-commit`, §17.1), never folded — it cannot be
a single atomic step. Exit `0` stamped or skipped · `1` invalid or unwaivered · `2`
malformed invocation (unresolvable commit-ish) · `3` internal.

**`waiver stamp --base --head`** is the **PR rubber-stamp**: it verifies every commit in
`base..head` and emits the aggregate verdict. A PR is *stamped* (APPROVE) exactly when
every commit is *stamped*.

`verify` classifies a single commit:

| Per-commit class | Meaning |
|---|---|
| **stamped** | has a waiver block; it schema-validates and the commit's diff stamps (§3.1) |
| **invalid** | has a waiver block (schema key present) but it fails to parse/validate, or stamps FAIL (guard, coverage, or emit-mismatch) |
| **unwaivered** | no waiver block — a normal commit needing human review |

Merge commits are skipped with a recorded reason; every other commit is verified against
its own first parent, whether or not that parent lies inside `base..head`. The aggregate
verdict is the **highest-severity** class present:

| Aggregate verdict | Condition | Intended GitHub review action |
|---|---|---|
| **REQUEST_CHANGES** | **any** commit is `invalid` | request changes — a present waiver that fails is a failed claim (mistake or bypass attempt), the one case worth actively flagging |
| **COMMENT** | no `invalid`, but **≥1** `unwaivered` alongside **≥1** `stamped` | comment — the stamped commits are mechanically vouched; the rest still need a human |
| **APPROVE** | **every** commit is `stamped` (≥1 commit, none unwaivered, none invalid) | approve — the whole PR is mechanically accounted for |
| **ABSTAIN** (no review) | **zero** commits carry a waiver block | emit nothing — preserves the §1 downside-bounded invariant (no stamp → today's normal review) |

Severity precedence is **REQUEST_CHANGES > COMMENT > APPROVE > ABSTAIN**. The rationale
for ranking `invalid` above `unwaivered`: an *absent* waiver is merely un-automated
(benign), but a *present, failing* waiver is an assertion the tool could not confirm —
exactly the thing to surface. This realises the user-facing rule verbatim: approve iff
all commits have a valid waiver; comment if only some do; request changes if any commit's
waiver is invalid.

**Only APPROVE removes review (downside-bound, restated for the aggregate).** COMMENT and
ABSTAIN **never grant** approval — they leave the PR under today's normal human review and
merely *add* a vouched-subset note (COMMENT) or *say nothing* (ABSTAIN). So no matter how
an automation layer wires these up, the worst case is status quo: the only verdict that can
*reduce* human review is APPROVE, and APPROVE requires every commit stamped. An automation
layer that treated COMMENT as approval would be its own bug, not a property of this tool;
§18.3 fixes the contract so it can't.

**Exit codes (extends §10 for `stamp`):** `0` = analysis completed with verdict ∈
{APPROVE, COMMENT, ABSTAIN} (no failed claim); `1` = REQUEST_CHANGES (≥1 `invalid` commit
— a failed claim); `2` = malformed invocation; `3` = internal error. The *verdict* is the
authoritative signal and always lives in `--json`; the exit code is the coarse "did any
claim fail" gate for shell use.

### 17.5 Verification integrity — bind to what actually lands

A per-commit verdict certifies **the exact commit SHAs walked**. Two ways the merged
artifact can differ from what was verified, both handled fail-closed:

- **Squash-merge.** If the host squashes the PR into one new commit, the verified commits
  never land — the squashed commit carries no waiver and is therefore **unwaivered** →
  falls to normal review (downside-bound holds; nothing unsafe is auto-approved). To *keep*
  the stamp through a squash, the squashed commit must itself carry a waiver accounting for
  its whole diff; otherwise the team uses merge/rebase-merge so the verified commits land
  as-is. The README documents this as the supported merge mode.
- **Rebase / force-push after verification.** A verdict is only honourable on the **exact
  head SHA** it was computed for. The automation layer (§18.3) must run `stamp` on the
  same head SHA it will merge, *after* the last push — and confirm host CI (§3.1.6) is green
  on that same SHA. A force-push that inserts a new commit produces a new head SHA → a new
  `stamp` run → the new (possibly unwaivered) commit is seen. Stale verdicts are never
  reused.

**Backstop binds to the verified head, not per-commit (clarifies §3.1.6).** "`tsc` clean +
affected tests green" is a property of the **head of the verified range**, established by
host CI on that head SHA — not re-derived per commit. This is what catches *composition*
risk: even if every commit stamps individually, the head backstop must pass on the final
tree. (For the reproductive family, emit-preservation composes — each commit's emit equals
its parent's — so an all-`stamped` range preserves base behaviour by construction; the head
backstop is the belt to that suspenders.)

### 17.3 Verdict report

`--json` emits a machine report: aggregate `verdict`, and per-commit `{ sha, subject,
class, reasons[], perOpFindings[], uncoveredFiles[] }`. This is the seam the automation
layer (§18.3) maps onto a GitHub review: the body summarises counts, each `invalid`
commit yields an inline-able finding, and the verdict selects
`APPROVE`/`COMMENT`/`REQUEST_CHANGES`. The §3.1.6 backstop applies unchanged — the
automation layer confirms host CI is green on the exact head SHA before honouring an
APPROVE.

### 17.4 Authoring a waivered commit

A waivered commit is an ordinary commit whose message body carries the ` ```waiver `
block (§17.1). Authoring goes through the repo's normal commit path (subject to the
`commit-msg` hook): the message carries a full subject/body/footer and is linted like
any other commit. The flow, driven by the §18.2 skill:

1. **`waiver apply <waiver>`** — expand the transform ops into the working tree
   (production code; hand-edit only test/doc files, §3.3).
2. **Write a normal commit**, including the waiver as a fenced ` ```waiver ` block in the
   message body. Place it **before any trailer paragraph** (`Refs:`, `BREAKING CHANGE:`)
   so `semantic-release` and other trailer consumers still read the footer as the
   terminal paragraph; `verify`/`extractWaiverBlock` are placement-agnostic (§17.1) and
   do not care. The block's JSON is the waiver verbatim.
3. **`waiver verify`** (no argument → `HEAD`) — folds the just-written commit through the
   §3.1 principle. This is the identical computation `stamp` runs on push, so the author
   confirms the claim **locally, one command after committing** — an under-covering
   waiver, a guard violation, or a malformed block is caught now, not at review time. If
   it fails, fix the waiver, `apply` again, and amend the commit (re-embedding the block).

**Why no wrapper, no `check`.** The former `waiver commit` (a one-shot `apply`+commit
that could express only a subject and bypassed the linted path) and `waiver check`
(schema + static guards) are **both removed**. In this flow every failure mode is
already covered: `apply` rejects a malformed schema or an unresolvable selector, and
`verify` — folding over the committed base — catches guards, coverage and emit
divergence (which is *stricter* than `check`'s current-tree guards). "Well-formed by
construction" is replaced by "confirmed before push," at the cost of one command.

**commitlint carve-out.** Pretty-printed waiver JSON can have lines longer than
commitlint's `body-max-line-length` (100). The block is machine content in the body, so
this repo sets `body-max-line-length: [0]` in `commitlint.config.js` and the single
`commit-msg` hook run at commit time accepts it. **Adoption note:** any repo adopting
waiver-stamp whose commitlint enforces `body-max-line-length` must do the same, or the
hook rejects waivered commits. This is the message channel's one standing tax — a
per-repo config line, documented in the README.

---

## 18. MCP server & Claude-plugin integration

The tool ships **inside a Claude plugin** so an agent can author and check refactors
without shelling out by hand. Three integration layers, smallest trusted surface first.

### 18.1 MCP server (`waiver mcp`)

A **stdio** MCP server (the local-subprocess transport every Claude plugin MCP server
uses) exposing the engine as tools. Stdio, not HTTP/SSE — the tool is a local CLI over a
local checkout; there is no network service to host. The server is a thin adapter over
the same library functions the CLI calls (`apply`, `verify`, `stamp`) — **no
second implementation**, so the §4 "one binary, no separate trusted code" property holds.

Built on `@modelcontextprotocol/sdk` (stdio transport) — the one new runtime dependency,
added to `package.json` and confined to `src/mcp.ts`; the engine library stays
SDK-free. Started by a new `waiver mcp` subcommand (the same binary), so a plugin
manifest points at `waiver mcp`.

Exposed tools (names stable; the MCP surface **mirrors the CLI**). `apply` takes the
waiver **inline as a JSON object** — friendlier for an agent that just authored one in
memory; `verify`/`stamp` read the **embedded** waiver from committed history, so they take
a commit / range, not a waiver:

| MCP tool | Wraps | Inputs | Returns |
|---|---|---|---|
| `waiver_apply` | `apply` | `{ waiver, cwd? }` | `{ files[] }` — expands the transform ops into the working tree at `cwd` |
| `waiver_verify` | `verify` | `{ commit?, cwd? }` | single-commit report (§17.3); `commit` defaults to `HEAD` |
| `waiver_stamp` | `stamp` | `{ base, head, cwd? }` | aggregate PR report (§17.2/§17.3) |

`cwd` defaults to the server's launch directory (the repo root) and bounds every file
mutation; an agent juggling multiple checkouts passes it explicitly. Each tool returns the
structured JSON report (§10, §17.3), never prose — the agent interprets it. The server does
no git mutation except where the wrapped command already does (`apply` writes files at
`cwd`; it never commits — committing stays explicit). The JSON Schema is **not** an MCP
tool (it is static): the skill (§18.2) carries it for output-constraint, avoiding a
needless per-call round-trip.

### 18.2 The skill — `refactor-with-waiver`

A plugin **skill** that teaches the agent the §16 loop end-to-end: when a refactor is
waiver-eligible (app-internal, single-project, symbol-level — §8), how to write the
selectors (§5.2), to prefer `waiver_apply` over hand-editing, and to land the result by
writing a normal commit with the ` ```waiver ` block in its body and confirming with
`waiver verify` (§17.4). It **replaces**
the scaffold's `generate-waiver` skill — on release `plugin/skills/generate-waiver/` is
removed and the manifest points only at `refactor-with-waiver`. The skill encodes the
**guaranteed-stamp discipline** (§3.3): apply for production code, hand-edit only test/doc
files, list the matching `change-test`/`change-docs` exclusions. It carries **worked
selector examples** for the fiddly cases (overload index, `:static`/`:instance`,
`NodeLocator` text+`nth`) and the **break-even guidance** (prefer a waiver when mechanical
fan-out is high; a one-or-two-reference change may be just as cheap to hand-edit) — so the
selector-iteration failure mode (§16) is taught against, not discovered in the field.

### 18.3 Automation layer (out of scope, named seam)

Turning a `waiver stamp --json` verdict into an actual GitHub review (approve / comment /
request-changes via the API) is the **automation layer** — still out of scope per §12,
but §17.3 fixes its input contract. A reference GitHub Action is a §20 README example,
not part of the tool.

---

## 19. Token-economy benchmark

Both §16 wins are **measured**, not asserted, and published in the README (§20). The
harness and methodology are designed to be **hard to dismiss as rigged** — the adversarial
risk both directions is named and controlled.

**Harness.** `bench/` drives the installed **`claude` CLI headless** in an **isolated,
minimal environment** so the measurement is stable and reproducible:
`claude -p "<task>" --output-format json --strict-mcp-config --mcp-config <bench-mcp.json>
--setting-sources '' --model claude-opus-4-8`. The empirically-confirmed JSON result
carries `usage.input_tokens`, `usage.output_tokens`, cache fields, and `total_cost_usd` /
`modelUsage["claude-opus-4-8[1m]"]`. No API key; runs against the operator's Claude
subscription. The "with" condition's MCP config exposes only the `waiver` server; the
"without" condition exposes none. Task prompts, fixture repo, and configs are checked in;
results land as `bench/results.json` + a generated `bench/results.md` table; `pnpm bench`
reproduces.

**Why output tokens are the headline metric.** A probe showed a trivial call carries
~19.8k tokens of *fixed environment overhead* (system prompt + tools) versus single-digit
*work* output tokens — so a total-token comparison is dominated by noise identical in both
arms. The benchmark reports **output tokens** as the primary, overhead-independent figure,
with input/total and `total_cost_usd` alongside for completeness, and runs each cell **≥3
times** reporting median + range (model output is non-deterministic).

**The two numbers (§16):**
- **Authoring** — *with*: the agent reads the code, writes a waiver, and calls
  `waiver_apply`; the cost **includes the apply→revise retry loop** (a malformed schema or
  unresolvable selector fails `apply` and is charged to the waiver path, per §16's honesty
  requirement).
  *without*: the agent reads the **same** code and emits the full refactor by editing files,
  **no refactor tool**. Both arms read the code — the win is not re-deriving the mechanical
  edits. Reported as output-token ratio without/with per task.
- **Review** — *with*: a reviewer confirms the change by reading the waiver + running
  `waiver stamp` (≈0 model tokens to re-verify mechanically). *without*: an LLM reviewer
  reads the full diff to judge it. Approximated as "tokens to emit/read the diff" vs "tokens
  to read the waiver." This is the larger ratio and the README headline.

**Task set (small but representative; fan-out increasing).** Many-reference rename (the
headline), extract a shared function used twice, move a module + rewire imports, **plus one
selector-stress task** (overloaded or static-method rename) to surface authoring-loop cost
honestly. The README states the **break-even**: at low fan-out the arms converge; the win
grows with references touched.

**Correctness gate (a token win only counts if the refactor is real).** *with*: the
committed `apply` output must **`verify`** against the fixture (§17.4). *without*: the emitted diff must `tsc --noEmit`
clean **and** be judged intent-matching by an independent `claude -p` grader against a
checked-in rubric. Any arm that fails is recorded as a **quality** result (e.g. the
*without* path silently broke a call site), reported **separately** from the token ratio,
never folded in.

**Reproducibility honesty.** Results are a dated **snapshot** (model + tool version + date
stamped in the JSON); model drift means counts may move on re-run. The README says exactly
this and points at `pnpm bench`, so the claim is checkable, not marketing.

---

## 20. README requirements

The README is the project's front door and must do four jobs, in order:

1. **Name the problem compellingly (lead with it).** Reviewers rubber-stamp or
   bottleneck on mechanical refactor PRs; LLMs burn tokens and make subtle errors
   re-deriving mechanical edits; "it's just a rename" is exactly the diff humans skim and
   miss a smuggled change in. State the cost of the status quo before the solution.
2. **Show the solution in one glance** — the §16 authoring loop and a stamped-commit
   example (§17.1), end to end, in a single short code block.
3. **Prove it with numbers — lead with review savings.** Two §19 tables, headline first:
   **(A) review tokens** — re-verifying a stamped commit (≈0 model tokens) vs an LLM
   reviewer reading the full diff (the bigger, more honest ratio, and the real product
   win); **(B) authoring tokens** — the without/with ratio per task the project was asked
   to produce, *with the selector-retry loop included* and the break-even stated so it
   reads as honest, not a sell. Both labelled with model (Opus 4.8), tool version, date,
   and a "snapshot, not a guarantee — run `pnpm bench` to reproduce" pointer.
4. **Make it installable + trustworthy** — plugin-install instructions (the carved-out
   final step) and a trust paragraph that explains *why* a stamp is trustworthy: it proves
   **by reproduction** (re-runs each op on the base and checks the result matches head, so
   no hand-edit can hide), is **fail-closed** (any doubt → human review) and
   **downside-bounded** (worst case = today's review) — "very likely safe and cheaply
   re-verifiable," not a formal proof (§1.1). Link `docs/spec.md` §1.1 (trust posture),
   §3 (stamping principle), and §13/§21 (roadmap).

---

## 21. Roadmap delta (additions to §13)

**v0 also ships:** commit-embedded waivers + `waiver verify` (one commit) / `waiver stamp`
(per-commit PR aggregation) (§17), the stdio MCP server (§18.1), the `refactor-with-waiver`
skill (§18.2), the `bench/` token-economy harness (§19), and a README that leads with the
problem and publishes the benchmark (§20). The GitHub-review automation layer (§18.3)
remains out of scope — `waiver stamp --json` is its contract.
