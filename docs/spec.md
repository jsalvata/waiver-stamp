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
| **Reproductive** (`rename`, `extract-function`, `move-to-new-file`) | transform | provably cannot alter runtime behaviour | re-run on base; output matches head |
| **Transitive** (`bump`) | transform | only pulls in code held to the same review bar | re-resolve lockfile + allowlist |
| **Confinement** (`change-test`, `change-docs`) | exclusion | provably cannot reach production | named files proven non-shipping; dropped from the comparison |

These are *different strengths of claim*. A reproductive op asserts "no behaviour
change." A `bump` explicitly **does** change behaviour — its safety rests on the
*upstream* review, not on preservation. Keep that distinction explicit.

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
   `O`. (Reproductive ops regenerate via the engine; `bump` applies the manifest edit
   and re-resolves the lockfile.)
4. **Exclusion** — for every exclusion op, predicate-check each named file (§6.2);
   any failure → **FAIL**. The union is the *excluded set*.
5. **Compare** — over every file **not** in the excluded set, the **compiler emit** of
   `O` must equal that of head (§7). Any file whose emit differs between base and head
   but is neither reproduced by `O` nor excluded → **FAIL**. (Coverage is thus
   automatic — nothing extra can slip through.)
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
- **Stamper** — `waiver stamp`: reads a waiver and, against `base` vs `head`, runs the
  §3.1 stamping principle (fold + emit-compare + guards) and emits a PASS/FAIL JSON
  report. No separate trusted code — the stamper *is* the runner's verification mode. It
  does **not** run `tsc` or tests: the backstop (§3.1.6) is the host CI's existing gate,
  confirmed by the automation layer. So the tool's only deps are ts-morph, the package
  manager (for `bump`), and git.

The **JSON Schema** is the single source of truth for the op vocabulary, doing triple
duty: LLM structured-output constraint, author lint, and the stamper's
closed-vocabulary gate.

---

## 5. Waiver format

JSON, governed by a published JSON Schema.

```jsonc
{
  "schema": "waiver-stamp/v0",        // vocabulary/validation version
  "tool":   "waiver-stamp@<x.y.z>",   // pins op semantics + bundled ts-morph; stamp refuses on mismatch
  "ops": [ /* ordered list; transform ops apply in order, exclusion ops are order-free */ ]
}
```

The header carries **only** what isn't already in the repo. TypeScript version, package
manager, and compiler options are **not** restated here — they live in the repo's
`package.json` / lockfile / `tsconfig` (a version-controlled, reviewed single source of
truth) and are read from the checked-out base/head. Restating them would risk a second,
divergent source. `ts-morph` is implied by `tool`. See §9 for how this grounds
determinism.

### 5.1 Operation vocabulary (v0)

```jsonc
// ── Transform · reproductive (behaviour-preserving) ─────────────────
{ "op": "rename", "target": {Selector}, "to": "newName" }
{ "op": "extract-function", "target": {NodeLocator}, "name": "fnName" }
{ "op": "move-to-new-file", "symbols": ["A","B"], "from": "path", "to": "path" }

// ── Transform · transitive ──────────────────────────────────────────
{ "op": "bump", "packages": ["@myorg/foo", ...] }       // manifest+lockfile only; allowlisted

// ── Exclusion · confinement ─────────────────────────────────────────
{ "op": "change-test", "files": ["path", ...] }         // arbitrary edits; verified test files only
{ "op": "change-docs", "files": ["path", ...] }         // verified doc files only
```

There is **no `format` op and no comment op** — formatting-only and comment-only
changes are absorbed by the modulo-formatting-and-comments comparison (§7), so they
need no operation (an otherwise-empty waiver stamps them). `change-docs` therefore
covers only doc *files* (e.g. `*.md`); comment-only edits to source files require no
op at all.

Optional same-family v0 add-ons (near-zero cost): `extract-constant`, `move-to-file`
(existing file).

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
- **`bump`** → claimed files ⊆ {manifest(s), lockfile}; only dependency **version**
  fields change; every bumped package is on the **central allowlist** (§14.2), matched
  by scope/name **and required source registry** (registry pinning is mandatory — a
  same-named scope on public npm is a typosquat vector). Apply: set the new versions,
  then **re-resolve** the lockfile with the repo's package manager; `O`'s
  manifest+lockfile must equal head's, and re-resolution must confirm each package came
  from its required registry. Trusts upstream review; **not** behaviour-preservation.

### 6.2 Exclusion ops (predicate-checked, removed from the compare)

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
- **`change-docs`** — each file is a non-shipping doc asset (`*.md`, etc.).

A file named by an exclusion op that **fails** its predicate → FAIL (it is not
removed from the compare; a hand-edited production file then mismatches `O`).

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
  whole-engine limit — `change-test`/`change-docs`/`bump` aren't project-scoped.
- **Public-API guard.** **FAIL** if a reproductive op targets a symbol exported from a
  published surface — `libs/*-sdk` / `libs/*-api-contract` public `index.ts`
  (cross-repo consumers invisible to the program). With single-project, v0 refactors
  are **app-internal only**.
- **Dynamic-reference scan.** Heuristic scan of targeted symbols for forms the LS
  can't track: `obj["name"]`, string-keyed DI/registry tokens, references in non-TS
  sibling files (JSON/SQL/templates). Hit → **FAIL** (the "modulo introspection"
  caveat, operationalised).
- **Emit-divergence guard.** The emit comparison (§7) uses tsc; tsc-equivalence implies
  deploy-equivalence except for constructs transpilers erase differently —
  **decorator metadata (`emitDecoratorMetadata`), `const enum`, class fields
  (`useDefineForClassFields`), `namespace` / `import =`**. If a source difference
  between `O` and head touches one of these, **FAIL** (→ review). (This is the
  enumerated-edge-case trade from §1.1: a short, stable list, fail-closed.)

> The v0 reproductive path targets **app-internal, single-project, non-lib** refactors —
> the common case for everyday refactor PRs.

---

## 9. Determinism

`stamp`'s re-fold/re-resolution must be bit-reproducible. Determinism rests on two pins,
not on values copied into the waiver:
- **The tool** — `tool@x.y.z` in the header fixes the op implementations and the bundled
  `ts-morph`; `stamp` refuses if run under a different version.
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
- Lockfile re-resolution is deterministic (frozen, repo's package manager).
- No wall-clock / randomness anywhere.

---

## 10. CLI & report

```
waiver apply <waiver>                                   # applies transform ops; writes files
waiver stamp <waiver> --base <ref> --head <ref> [--json]
waiver check <waiver>                                    # schema + static guards only (fast lint)
```

Exit: `0` stamped · `1` stamping/guard/coverage failure · `2` malformed waiver /
header mismatch · `3` internal error. `--json` emits a machine report (`stamped`,
per-op + per-file findings, uncovered-diff list, failure reasons) — the seam for the
CI/automation layer.

---

## 11. Worked examples

| Change | Waiver ops | Verdict |
|---|---|---|
| share a helper between two callers | `extract-function` ×2 | Stamps (added JSDoc = comments → invisible). |
| extract a shared module to a new file | `move-to-new-file` + `extract-function` ×2 | Stamps: a hand-added named return interface is type-only → erased from emit → invisible to the compare (§7). |
| change a string constant's value | — | Out of scope: string-value change, not behaviour-preserving; nothing reproduces it → mismatch → review. |
| refactor + hand-edited tests | `[rename, change-test]` | Stamps: `rename` reproduces source; test files excluded + predicate-passed; suite green. |
| internal lib bump | `[bump]` | Stamps: manifest/lockfile-only, allowlisted, lockfile re-resolves to head. |
| README typo / reformat | `[]` or `[change-docs]` | Reformat/comment-only → empty waiver. `*.md` edit → `change-docs`. |

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

**v0 — single-project; transform + exclusion ops.**
Ops: `rename`, `extract-function`, `move-to-new-file` (reproductive); `bump`
(transitive, configurable allowlist); `change-test`, `change-docs` (confinement).
Reproductive ops single-project + app-internal (§8). Stamping principle, fold +
emit compare (§7) + exclusions, static guards, JSON report. Covers the extract / share /
module-extraction cases plus test-only / docs-only / bump / mixed (§11).

**Later.**
- Multi-project reproductive ops: Nx project-graph-aware program set covering all
  dependents; rename/move across project boundaries; relax the single-project guard to
  "all consumers covered"; principled `libs/*` handling (public-API guard → cross-repo
  *impact report* where downstream repos are inspectable).
- More reproductive ops: `inline-variable`, `extract-type`, convert-family, `revert`,
  codegen-regeneration.
- An additive `add-export` op, if widening export visibility on its own proves common
  (other additive type/JSDoc edits already pass for free under emit comparison, §7).
- Custom non-LS ops with mandatory tsc+tests gating.
- Cross-repo bump verification (released-artifact check).

---

## 14. Decisions

1. **Runner distribution — own repo.** `waiver-stamp` lives in its own repo,
   version-pinned in the waiver header. Its own trustworthiness is accepted per §1.1
   (trusted, not verified) — we don't over-engineer vouching for the tool itself.
2. **`bump` allowlist — central, baked into the pinned runner.** A central config
   shipped with the pinned tool version lists allowed packages by scope/name **and
   required source registry**. Registry pinning is mandatory: "`@myorg/*` is vetted"
   only holds if it resolves from the *internal* registry (a same-named public-npm scope
   is a typosquat vector), so re-resolution confirms the source registry, not just the
   name. Optional per-package version policy (`maxBump`); default = any version of an
   allowlisted internal package (the trust is upstream review, not a version bound). The
   allowlist is trust-critical, so changes to it require human review — you cannot `bump`
   to widen it.
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
- **Header carries only `schema` + `tool`; the toolchain comes from the repo.**
  *Rejected restating TypeScript/package-manager/compiler-options in the waiver:* they're
  already pinned by the base commit's `package.json`/lockfile/`tsconfig`, so a waiver copy
  would be redundant and could drift — and emit must use the *repo's* TypeScript +
  `tsconfig` to match its build semantics, so a disagreeing waiver value would be a bug.
  The stamper reads the toolchain from the checked-out base/head (§9); `ts-morph` is the
  tool's own dependency, pinned by `tool@x.y.z`.
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
  published-package paths, bump allowlist, reference transpiler) are **configuration**;
  the §11 worked examples are generic scenarios, not tied to any repo.
- **Accept test-weakening and type-weakening** — runtime-safe; future-safety erosion is
  noted, not gated (mirrors each other).
- **Composition from day 0** via `change-test` + the order-independent exclusion model.
- **Boundary case:** a PR *labelled* "rename" that only changes a string-literal *value*
  is **out of scope** — not a symbol op and not behaviour-preserving; no op reproduces
  it, so it falls to review.
