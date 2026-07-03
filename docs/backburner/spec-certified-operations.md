# certified-operations — Specification

> **Status: backburner (not scheduled).** Parked in `docs/backburner/` on
> 2026-07-04. The mechanism is sound and the design is complete, but as a *separate*
> tier it isn't worth the implementation and cognitive overhead. It moves off the
> backburner **only if** we find an easy way to express certification *inside* a
> waiver (see §8, "Relationship to waivers" — waiver = certified-op + emit-proof +
> guards). Absent that, this is a design record, not a roadmap item.
>
> This is a **separate, standalone** spec for a mechanism **distinct from waivers**.
> If implemented it would merge into `docs/spec.md` as new sections beside §2/§3 (the
> operation model), §5.1 (vocabulary), §8/§9 (guards & determinism), and §17
> (commit-embedded blocks & verdict aggregation); §10 below gives the concrete merge
> plan. Every `§N` reference points at the *existing* `spec.md` **unless it is written
> `(this doc)`**, so the seams are visible. Read this as a **sibling** to that spec —
> same voice, same fail-closed discipline, a **weaker claim** with **broader reach**.

> **certified-op**: a tool that confirms, mechanically and deterministically, that a
> commit's diff is **exactly** operation `O` applied to its parent —
> `head_tree == O(parent_tree)`, nothing added, nothing omitted. It makes **no**
> safety claim and can **never** auto-approve a PR. Its product is **review-scoping**:
> shrink the reviewer's unit from *N lines of diff* to *one operation description*,
> with a mechanical guarantee that the description is the **whole, faithful** story.

---

## 1. Purpose & positioning

A waiver (`docs/spec.md`) answers *"is this change safe to auto-approve?"* A **certified
operation** answers a different, humbler question: *"is this diff exactly what the
author says it is — the complete and faithful application of operation `O` to the
parent, and nothing else?"* It **certifies provenance, not safety**.

Some diffs are safe to auto-approve; waivers handle those (APPROVE — removes review). A
**larger** set of diffs are *not* safe to auto-approve but are still **mechanically
reproducible** from a one-line description of what the author did. certified-op is for
those: it never removes review, but it shrinks the reviewer's unit to a single operation
and **proves** that operation is the entire change.

The two are complementary tiers of one review-reduction system:

| | **waiver** (`docs/spec.md`) | **certified operation** (this doc) |
|---|---|---|
| Claim | *no un-reviewed change to production behaviour* | *the diff is exactly `O(parent)`* |
| Method | reproduce + **emit-equivalence** (§7) + static guards (§8) | reproduce + **tree/diff equality** |
| Can change behaviour? | **no** — behaviour-preserving only | **yes** — `O` may be behaviour-changing |
| Best PR verdict it can grant | **APPROVE** (removes human review) | **COMMENT** — *"review the operation, not the diff"* — **never APPROVE** |
| Reviewer's unit | the safety argument (usually nothing to read) | **one operation description**, guaranteed complete |
| Needs a compiler? | yes (emit comparison) | **no** — pure replay + tree equality |

### 1.1 The running example — the `.js → .ts` import-extension rewrite, honestly split

Lead with the real change this repo shipped, **and with the split-commit discipline it
teaches** (§9.4). Commit `1813494` (*"feat: use .ts extensions in relative imports"*) is,
as it actually landed, a **bundle** of two kinds of change:

1. a **codemod**: **112 relative import/export specifiers rewritten `.js → .ts` across 34
   `.ts` source files** (under `src/` and `scripts/`), flipping every `from './x.js'` to
   `from './x.ts'`; and
2. an **enabling change**: bumping the TypeScript floor (`package.json` `^5.6.2 → ^5.7.0`
   plus the matching `pnpm-lock.yaml` line) and flipping the `tsconfig.json` flag
   `rewriteRelativeImportExtensions: true` (TS 5.7+).

**The shipped commit as-is does NOT certify** — and that is the point, not a
counter-example. Its diff is *codemod output **plus*** three edits (`package.json`,
`pnpm-lock.yaml`, `tsconfig.json`) that the specifier-rewrite executor (§5.2) does **not**
produce. Under this doc's own §3.1 step 4 (whole-tree byte equality) and the §4
exclusivity proof, those three edits are exactly the out-of-band `e` that breaks
`head == O(base)`, so **as a single commit it is `failed-certification`, not `certified`**
(§6). This is the mechanism working: the flag flip is the *behaviourally relevant decision*
(it changes the emitted `.d.ts` type surface), and certification refuses to launder it into
a mechanical sweep. The **intended** shape is the §9.4 split:

- **Commit A** — the config change alone (TS floor bump + `tsconfig` flag). Enabling
  `rewriteRelativeImportExtensions` changes the emitted `.d.ts` specifiers `.js → .ts`, so
  this is a **behaviour-relevant** decision that gets **normal human review** (unwaivered),
  or is expressed via the waiver `bump`/config ops if those apply. It is *not* certifiable
  as a specifier rewrite, because it isn't one.
- **Commit B** — the **codemod alone**: 112 relative specifiers across 34 source files,
  nothing else. **This is the certifiable artifact.**

Commit B's operation is one sentence —

> *rewrite each relative import/export specifier ending in `.js` to end in `.ts`.*

The reviewer reads **that one operation** and confirms the tool replayed it faithfully
across all 112 sites. They never read 112 near-identical `-'./x.js'` / `+'./x.ts'` line
pairs looking for the one that's wrong. Critically, Commit B leaves the four
`@modelcontextprotocol/sdk/*.js` **package subpaths** untouched — those are real published
`.js` entry points, not relative specifiers — **and** it leaves untouched the relative
`.js` **string literals in test fixtures** (e.g. `from './orders.js'` and `from
'./rates.js'` in `src/engine/ops/move-file.test.ts`, deliberately kept `.js` for NodeNext).
A naive `sed 's/\.js/\.ts/'` would have corrupted the package subpaths; a naive
*text*-scoped rewrite would have corrupted the fixtures. The executor's **structural
scoping to specifier AST nodes** (§5.2) is exactly what makes *"review the operation"* safe
to trust — and §5.2/§7.2 make that scope legible so a reviewer glancing at an
un-rewritten relative `./orders.js` can reconcile it against the one-line description.

```operation
{ "schema": "certified-op/v0",
  "operation": { "op": "rewrite-import-extension", "from": ".js", "to": ".ts", "scope": "relative" } }
```

**Downside-bounded invariant (inherited, `docs/spec.md` §1).** A certified commit only
ever *narrows the unit of review* — it never removes review (only APPROVE does that, and
certified-op can't produce APPROVE), never blocks, never auto-rejects. A missing or failing
certification falls to today's normal review. **Only APPROVE removes review, and
certification never grants APPROVE.** Worst case = status quo.

**Non-goal:** asserting anything about what the change *does*. An operation *"replace every
`assertEquals(` with `assertNotEquals(`"* certifies perfectly cleanly and inverts your
whole test suite. Certification says **the diff is exactly that operation**; whether that
operation is a good idea is **the human's** call (§2).

---

## 2. Trust posture — certification of provenance, not safety

Like waiver-stamp (`docs/spec.md` §1.1), **certified-op does not produce a proof that the
change is safe, and is not meant to.** But it makes a *different* claim, and the
difference is the whole point.

- A **waiver** certifies *provenance **and** safety*: "this diff is `O(parent)` **and**
  `O` preserves behaviour." The safety half rests on the emit heuristic and the
  enumerated guards (§7, §8) — honest, but inexact (§1.1): behaviour equivalence is
  undecidable, so the waiver approximates it.
- A **certified-op** certifies *provenance only*: "this diff is **exactly** `O(parent)`."
  Nothing about safety.

That narrower claim is **mechanically stronger** where it applies. Certification is
**deterministic replay plus tree equality** — there is **no undecidable question in the
loop**: no behaviour-equivalence oracle, no emit heuristic, no transpiler enumeration.
Either the replay reproduces the tree byte-for-byte or it does not. In the single
dimension of *"is the diff faithfully and completely this operation?"* certification is
mechanically strong — in that narrow sense **stronger** than the waiver's emit-equivalence
heuristic. But it certifies **what changed**, not **that the change is safe**. Spell the
split out exactly.

**Guaranteed by a `certified` verdict (the tool owns these):**

1. The diff `parent → head` is **byte-for-byte** the result of applying `O` (with the
   embedded parameters) to `parent`, replayed by the tool's own pinned executor (§5).
2. **Exclusivity** — the diff contains **nothing** beyond `O(parent)`: no smuggled edit,
   no omitted site (§4). `O` is the complete, faithful account of the change.
3. **Reproducibility** — any party with the tool **at the executor version the block binds
   (§5.3)** and the parent tree gets the **identical** result. The verdict is not the
   author's word; it is independently re-derivable.
4. `O`'s executor is a **closed, tool-shipped, version-pinned** function (§5), never
   attacker-supplied code.

**NOT guaranteed — the human still owns these:**

- **Whether `O` should have been applied at all.** Certification is silent on semantics;
  a behaviour-changing `O` certifies as cleanly as a behaviour-preserving one.
- **Whether `O`'s *parameters* are correct — or whether they match the reviewer's mental
  model of the one-line description.** §4 proves *diff == `O(params)`*; it does **not**
  prove that `O(params)` is what the reviewer pictured when they read *"rewrite
  `.js`→`.ts`"*. A pattern can faithfully match a site the author (or reviewer) didn't
  picture — that is a **judgement** risk certification does not close (§2.1, §11). The
  pattern is certified; the **judgement encoded in the pattern** is the reviewer's, which is
  why the **exact touched sites, file scope, and match count are surfaced loudly** (§7.2).
- **Everything a waiver's emit-comparison and static guards would check** — because
  certified-op checks **none** of it. In particular a certified commit is **not** gated on
  `tsc` or tests by certification itself (that is the head backstop, §6.4).

**The mantra:** treat a certification as *"this diff is provably, exactly this operation —
now go read the operation,"* never as *"this diff is safe."* Trust comes from **replay +
tree-equality + a closed, version-pinned executor set** (§5), and stops precisely at
*what changed*.

### 2.1 The social failure mode (named, not hidden)

Certification only delivers value if the reviewer **actually reads `O`**. If they
rubber-stamp the COMMENT note without reading it, they have reviewed nothing — worse than
reading the diff, because the diff at least *existed* in front of them. And because §4
guarantees only *diff == `O`* (not *`O` == the reviewer's mental model*), a broad or
mis-scoped parameter can perform intended visible churn **and** quietly touch an
unintended site, hidden behind a one-line description. This is a real, un-gated residual,
documented in the `docs/spec.md` §1.1 spirit (a named, bounded acceptance rather than a
silent one):

- The report (§7.2) is **obligated** to make `O` loud and legible — the pattern in plain
  words, the file scope, the match count, **and the enumerated list of touched sites** —
  so that reading it is obviously cheaper than ignoring it and obviously more informative
  than skimming N diff lines, **and so scope-broadening is visible per site, not hidden
  behind a bare count**.
- The verdict is **COMMENT**, never APPROVE (§6). The PR is *not* auto-merged; a human is
  still in the loop and is *pointed at* `O`. The tool's job is to make `O` the smallest
  sufficient thing to read, not to remove the reader.

This is the certified-op analogue of §16's *"the reviewer never reads the mechanical
part"* — except here the reviewer reads the **operation** instead, and the design's job is
to make that operation legible enough that reading it beats skimming the diff.

---

## 3. The certification model — `head == O(parent)`

An **operation** `O` is a **pure, deterministic function** from *(parent tree,
parameters)* to a new tree (§5.3). A commit `C` **carries an operation** if its message
embeds an ` ```operation ` block (§5.4). Certification reuses the existing **fold seam**
(`docs/spec.md` §3.1 step 3 "Fold"; §4 "Runner"): the runner already applies transform ops
to a clean base checkout to produce a tree `O`. Waiver stamping then compares `O` to head
**by compiler emit** (§7). Certification exposes the *other half* of that seam as its own
verdict tier: compare `O` to head **by tree/diff equality**, with **no emit step**.

### 3.1 The certification principle

> **Note on cross-referencing after merge.** This doc's §3.1 (below) and `docs/spec.md`
> §3.1 (waiver stamping) are *different* principles that currently share a number. Where
> disambiguation matters this doc writes **"§3.1 (this doc)"** vs **"`docs/spec.md`
> §3.1"**; the §10 merge plan assigns them distinct section numbers.

With `base = C^1` (git **first parent**) and `head = C`, commit `C` **certifies** iff
**all** hold:

1. **Vocabulary gate** — `O.op` is in the **closed executor vocabulary** (§5); an unknown
   executor → **FAIL closed** (never *"run the author's script"* — §5.1). Mirrors
   `docs/spec.md` §3.1 step 1.
2. **Parameter validation** — `O`'s parameters schema-validate for that executor (§5.4);
   a malformed or under-specified `O` → **FAIL closed**.
3. **Executor-version compatibility** — the verifier's pinned executor version is
   **compatible with the version the block binds (§5.3)**; a skew outside the compatible
   range → **FAIL closed** (never a silent mis-replay).
4. **Resource-bounded deterministic replay** — check out `base`'s tree clean; run the
   operation's executor as a **pure function of `(parent tree, parameters)`** → tree
   `O(base)` (§5.3), **under an explicit wall-clock / memory / file-count bound (§5.3
   clause 4)**. Purely mechanical; **no tsc, no emit, no network**. Exceeding the bound →
   **FAIL closed** (never an OOM/timeout crash).
5. **Tree equality** — `O(base)` must equal `head` **exactly**, compared as a **git tree**
   (path set + blob content, byte-for-byte, §3.2). Any path present/absent/differing
   between `O(base)` and `head` → **FAIL** (§4 makes this the forced-complete property).
6. **Coverage is automatic and total.** Because step 5 compares the **whole tree**, any
   byte of the diff not produced by `O` is a mismatch. There is no separate coverage
   check and no exclusion phase to forget (contrast `docs/spec.md` §3.1 step 5, where
   coverage is derived from the emit compare and exclusion ops carve out test/doc files —
   certification has **no** exclusion phase, §9).

Fail anywhere → the commit is **failed-certification** (§6), a **failed claim** — never
silently downgraded to *"just needs review."*

**No backstop precondition inside certification.** Unlike `docs/spec.md` §3.1 step 6,
certification makes no behaviour claim, so `tsc`-clean and green-tests are *not* a
certification precondition. (A PR still runs the host CI gate as always; certification
simply does not depend on it. The head backstop still binds the *verified range* — §6.4.)

### 3.2 What "exactly" means

Tree equality is **byte equality of tracked content, path for path** — the natural notion
for a claim about *provenance of a diff*:

- **Content:** every tracked file's bytes in `O(base)` equal its bytes in `head`.
- **Path set:** the set of tracked paths matches (an executor that should have
  created/deleted/renamed a file but didn't → mismatch).
- **No emit canonicalisation.** Unlike the waiver emit compare (`docs/spec.md` §7, which
  compares *tokenised compiler emit* so formatter/comment/type-only drift is invisible),
  certification compares **tracked bytes**. This is the sharpest technical divergence from
  the waiver, and it is deliberate: the waiver *forgives* formatting/comment/type-only
  drift because its claim is *same behaviour*; certification's claim is *same diff*, so that
  same looseness is exactly what it must **refuse** — a stray whitespace change `O` didn't
  produce is precisely the smuggled edit §4 must catch.
- **The executor must therefore be byte-exact and non-reformatting (§5.3 clause 3).** This
  is a hard constraint on the executor, not on the operation author: a rewrite executor
  **MUST edit only the matched span** (the specifier string) via a **minimal in-place text
  splice**, and **MUST NOT reprint the enclosing statement or reflow any untouched region**.
  A naive "mutate the AST node, then re-serialise the file" strategy would let the
  serialiser's own style (quote kind, newline, indentation) rewrite untouched bytes and
  FAIL a faithful operation on any repo whose style differs from the serialiser default —
  the executor must not do this (§5.2, §5.3).
- **Line endings / mode / normalisation:** see §13 Q3 — raw-bytes vs. git-normalised (EOL /
  `.gitattributes`) equality is an **open decision**; either way a deliberate mode or EOL
  change is part of the diff and must be reproduced by `O`.

The strictness is the point: any looseness reopens the §4 gap through which an out-of-band
change could slip.

---

## 4. The forced-complete-description property (the crux of the value)

This is the property that makes reviewing `O` equivalent to reviewing the diff. State it
precisely and prove it — **and bound exactly what it does and does not cover.**

**Claim.** If `C` is certified with operation `O` **and parameters `p`**, then `O(p)` is
the **complete and faithful** description of `C`'s entire diff against `C^1`. The author
**cannot** under-describe: there is no diff `O(p)` fails to account for, and no way to
smuggle a change `O(p)` does not produce.

**Proof (mechanical, not statistical).** Certification (§3.1) requires
`O(base) == head` as **whole trees**.

- *Exclusivity.* Suppose the author's real change were `O(p)` **plus** an out-of-band edit
  `e` (an extra line, a `tsconfig` flag, a manifest bump — exactly the three edits that
  make the real commit `1813494` fail as a single commit, §1.1). Then `head = O(base) + e`,
  so `head != O(base)` whenever `e` is non-empty → **tree inequality → FAIL** (§3.1 step 5).
- *Faithfulness.* Suppose instead the author **omitted** a site `O(p)` would produce
  (hand-reverted one of the 112 rewrites). Then `O(base)` contains that site and `head`
  does not → inequality → **FAIL**.

Therefore a **certified** verdict is possible **only** when the diff is *exactly*
`O(p)` — no more (exclusivity), no less (faithfulness). ∎

**What the proof does NOT cover (stated explicitly).** The proof is over **bytes**, given
**fixed parameters `p`**. It guarantees *diff == `O(p)`*; it does **not** guarantee that
`O(p)` matches the reviewer's mental model of the one-line description — the parameters `p`
are **author-shaped** within the closed vocabulary, so an author can choose a legitimately
typed `p` whose blast radius exceeds what the reviewer pictures (§2.1). That residual is a
**judgement** risk, not a soundness one, and it is fought on the report surface (§7.2:
enumerate the touched sites) rather than in this proof.

**Consequences, stated as the product.**

- **Reviewing `O(p)` == reviewing the change.** The reviewer does not have to *trust* that
  `O` summarises the diff; the tool has **mechanically confirmed** it does. A prose PR
  description is the author's *claim* about the diff; `O(p)` is a *certified* account of it.
- **The author cannot hide in the noise.** The classic review-evasion — bury one
  meaningful line in 112 lines of mechanical churn — is **impossible under
  certification**: that one line is exactly the `e` that breaks tree equality. To land the
  meaningful line the author must **split it into its own commit** (§5.4, §9.4), where a
  human sees it in isolation. (This is why `1813494`'s config edits force a split.)
- **The teeth come entirely from the executor constraint.** For this to hold, `O` must be
  a **total, deterministic function of (parent, parameters)** with **no** author-supplied
  code (§5). If `O` could do anything, `head == O(base)` would be vacuous — an executor
  `O = "produce head"` trivially "certifies" any diff. *The value of certification is
  exactly the constraint on what `O` may be* (§5.1). This is the crux's crux.

---

## 5. Executor vocabulary & the determinism contract (the trust boundary)

### 5.1 The trust boundary — open in intent, closed in execution

To certify `head == O(parent)` the tool must **execute `O`**, so the tool must **contain
the executor**. This is the load-bearing design decision, and it cuts one specific way:

> **`O` is open in *intent* but its *executors* are a CLOSED, tool-shipped,
> VERSION-PINNED set.** Certification is emphatically **NOT** *"run this arbitrary script
> and diff the result."*

An operation names an executor from a fixed vocabulary and supplies **parameters**; it
does **not** supply **code**. Letting `O` be an author-supplied script
(`{ "op": "script", "run": "sed -i …" }`) destroys **both** load-bearing properties at
once:

- **It executes attacker-controlled code** at certification time — on the reviewer's / CI
  machine, against the repo. That is a remote-code-execution primitive wearing a
  certification badge, with no analogue in the waiver model. The whole point of a *closed*
  vocabulary (`docs/spec.md` §3, §8) is that the tool only ever runs code the **tool's**
  maintainers shipped and pinned.
- **It destroys reproducibility.** A script's output drifts with interpreter version, OS,
  locale, shell, filesystem ordering, wall-clock, network, and every transitive dependency
  it reaches for. Replayed elsewhere it can diverge — so `head == O(base)` becomes a
  statement about *one machine at one moment*, not a reproducible fact. The
  forced-complete property (§4) evaporates: a non-deterministic `O` can "match" head on
  the author's box and fail — or *match differently* — on the reviewer's.

So the vocabulary is closed for the **same reason** the waiver's op vocabulary is closed:
trust flows from *"the tool performed a known, pinned transformation,"* never from
inspecting arbitrary behaviour. Adding a new executor is a change to the **tool**,
reviewed and released like any other — never a runtime capability an author unlocks.

### 5.2 The first executor — structural relative-import-extension rewrite

The v0 executor is the one the running example (§1.1) needs:

```jsonc
{ "op": "rewrite-import-extension",
  "from": ".js",            // specifier suffix to match
  "to":  ".ts",             // replacement suffix
  "scope": "relative" }     // "relative" | "package" | "all"  (v0: "relative" only)
```

> **`rewrite-import-extension`** — for each relative import/export **specifier** in the
> loaded program, if the specifier ends in `<from>`, rewrite the extension `<from> → <to>`.
> Built on **ts-morph** (used to *locate* specifier nodes), applying a **minimal in-place
> text splice** to the matched specifier substring only.

**The scoping is the whole safety story of the executor** — and it is why *"review the
operation"* beats *"review 112 lines"*. Two orthogonal scoping rules, both structural, both
made legible in the report (§7.2):

- **Specifier-node scope (what counts as a candidate).** The executor touches **only the
  `StringLiteral` specifier position** of an `import` / `export … from` / dynamic
  `import()` / `import type` node, resolved against the AST — never a comment, never an
  ordinary string literal, never an identifier, never a `.js` substring inside a URL or a
  log message, **and never a relative `.js` string that is not a specifier node** (a data
  string, a `jest.mock('./x.js')` argument, a `.js` inside a test-fixture *source string*
  such as `from './orders.js'` embedded in `move-file.test.ts`). Those relative-looking
  `.js` strings are **out of scope by construction** and left as-is — and §7.2's report
  distinguishes them from the package-subpath carve-out, so a reviewer who sees an
  un-rewritten relative `./orders.js` can reconcile it from the operation description.
- **Relative-only scope (which specifiers, of the candidates).** With `scope: "relative"`
  the executor rewrites **only** specifiers beginning `'./'` or `'../'`. This is exactly
  what a naive `sed 's/\.js/\.ts/'` gets catastrophically wrong: it would corrupt the four
  real package subpaths in the running codemod —
  `'@modelcontextprotocol/sdk/client/index.js'`, `'…/inMemory.js'`, `'…/server/mcp.js'`,
  `'…/server/stdio.js'` — which resolve to published `.js` entry points and **must** keep
  `.js`. The structural executor leaves them untouched **by construction** (non-relative →
  out of scope), and certification then *proves* it did. `scope` is part of `O` and prints
  loud in the report (§7.2).

**Program scope and deterministic iteration.** The executor loads a ts-morph `Project` from
`base`'s `tsconfig.json` (§5.3 clause 2); for the running repo that `include` is
`["src", "scripts", "vitest.config.ts"]`, so the sweep spans `src/` **and** `scripts/`
(e.g. `scripts/bench.ts`, `scripts/gen-schema.ts`) **and** `vitest.config.ts` — multi-root,
not just `src/`. Because the executor edits many files, its output **MUST be invariant to
file-visitation order and locale**: the executor **sorts the program's source files by
normalised POSIX path under a fixed byte collation** before applying edits, and edits each
file by minimal in-place splice so cross-file order cannot affect any file's bytes.
Reliance on `tsconfig` glob-expansion order, `readdir` order, case-folding on
case-insensitive filesystems, or `Intl` collation is **forbidden** (§5.3 clause 1); a
determinism test replays the executor across two filesystems/locales and requires
byte-identical output (§11 invariant).

**Config the operation is itself changing.** `rewriteRelativeImportExtensions` affects
tsc's *emit*, not *what counts as a relative specifier*, so the set of specifier nodes the
executor rewrites is **invariant** to that flag. The executor consults **only `base`'s**
(pre-image) `tsconfig` (§5.3 clause 2). Nonetheless, a commit that alters the executor's
own config inputs (`tsconfig` `moduleResolution`, the extension-rewrite flag, etc.)
**cannot be a clean single-operation commit** and **must be split** (§9.4) — which is
exactly why the real `1813494` splits into config-Commit-A + codemod-Commit-B (§1.1).

### 5.3 The determinism contract

Every executor is a **pure function of `(parent tree, parameters)`**, producing
**byte-identical output on replay**. The contract mirrors `docs/spec.md` §9, restated here
because this doc is self-contained:

1. **Pure, no ambient inputs.** No wall-clock, no randomness, no network, no environment
   reads, no filesystem-iteration-order dependence, **no locale/collation dependence**.
   Given the same `(parent tree, parameters)`, the executor yields a **byte-identical**
   tree on every replay, on every OS/filesystem/locale.
2. **Version-pinned — exactly, not by caret.** An executor's behaviour is pinned by the
   **tool's own released version** (it ships *in* the tool) and, where it consults a
   third-party engine whose output can drift (ts-morph reprinting/positions, the repo's
   TypeScript), that engine is pinned to an **exact version in the tool release** — **not a
   caret range**. (The repo currently declares `ts-morph: ^24.0.0` / `typescript: ^5.6.2`;
   a certified-op release **MUST** resolve these to exact versions, because a ts-morph or TS
   minor bump can change AST positions and reprinting and therefore the compared bytes.)
   Where the executor consults the **repo** (module resolution, specifier identification),
   it reads the repo's committed toolchain from the checked-out **`base`** — never values
   copied into the operation block (§5.4); parameters are the *only* author-supplied input,
   and they are **data, not code**. The **executor version a certification is relative to**
   is recorded in the report (§7.2) **and bound by the block per §13 Q2's resolution**, and
   §3.1 step 3 fails closed on an incompatible verifier version.
3. **Byte-exact, non-reformatting.** The executor edits **only the matched span** and
   **MUST NOT** reprint or reflow any untouched region (§3.2). Concretely for
   `rewrite-import-extension`: splice the specifier substring in place; do **not** call a
   whole-file re-serialiser whose style (quote kind, newline, indentation) would rewrite
   untouched bytes. A determinism test requires that a no-op-equivalent rewrite over a
   single-quoted / CRLF / tab-indented repo is **byte-identical** to the input outside the
   matched spans.
4. **Total, resource-bounded, or fail-closed.** If an executor cannot deterministically
   apply `O` (ambiguous parameters, an unrepresentable edit), it **FAILs** — it never
   guesses. Replay runs under an explicit **wall-clock / memory / file-count bound**;
   because certification runs against **untrusted PR trees** (§11), the bound is on the
   **replay** (which loads and re-parses the whole program via ts-morph — cost scales with
   the *repo tree*, not the block size), not merely on the embedded block. Exceeding the
   bound → **failed-certification** (fail-closed), never an OOM/timeout crash. A partial or
   best-effort replay is a failed certification, never a silent success.

**Precedent — the `lint-fix` op (`docs/spec.md` §5.1, §6.1).** The waiver spec already
ships a **tool-reproducible** transform: `lint-fix` delegates to *"the repo's own committed
lint toolchain … at the lockfile-pinned version,"* and *"reproduction is the whole claim —
a hand edit smuggled in alongside the lint fix still mismatches → FAIL."* certified-op
**generalises that idea into its own verdict tier**: it keeps the reproduce-and-compare
core, (a) drops the emit comparison for a **literal tree** compare, (b) exposes it as **its
own verdict tier** (§6) rather than folding it into a behaviour-preservation stamp, and —
crucially — (c) **drops the behaviour-preservation requirement**, so the executor may be
behaviour-*changing*. Both share the decisive degradation direction: **if the executor
proves non-deterministic, `O(base) != head` → mismatch → FAIL. Non-determinism degrades to
a false FAIL, never a false certification.**

### 5.4 The commit-embedded ` ```operation ` block

certified-op reuses the `docs/spec.md` §17.1 commit-embedded machinery **wholesale**, with
exactly one new concept: a **distinct fence** so an operation block is *never* confused
with a waiver — a reader, a parser, and an automation layer must be able to tell *"this
commit claims safety"* from *"this commit claims faithful provenance"* at a glance.

````text
feat: rewrite relative .js import specifiers to .ts

Codemod-only commit (the enabling tsconfig flag + TS floor bump land
in the preceding commit, which gets normal review). Rewrites every
relative import/export specifier ending in .js to .ts. Package subpaths
(@modelcontextprotocol/sdk/*.js) and relative .js strings in test
fixtures are not specifier nodes and are left untouched by construction.

```operation
{
  "schema": "certified-op/v0",
  "operation": {
    "op": "rewrite-import-extension",
    "from": ".js",
    "to": ".ts",
    "scope": "relative"
  }
}
```
````

**Format.** JSON root: `{ "schema": "certified-op/v0", "operation": { … } }` — a
**single** operation, not an `ops[]` array. A certified commit is one atomic operation
over its parent, matching *"a commit is one atomic step"* (§17.1). The header carries
**only** `schema`; TypeScript version / package manager / compiler options come from the
checked-out repo (§5.3) — restating them would risk a second, divergent source (§5, §9).
(Whether the header must additionally bind a **minimum executor version** is §13 Q2.)

**Parsing algorithm (pinned, fail-closed) — deliberately isomorphic to `docs/spec.md`
§17.1, distinct fence:**

- `verify` reads the **full** message via `git log --format=%B` (never the truncated
  subject) and scans for **every** fenced ` ```operation … ``` ` block (info-string exactly
  `operation`). The block is **self-identifying by its fence** — a ` ```waiver ` or
  ` ```json ` block is **not** an ` ```operation ` block and is ignored here.
- The root `schema` must equal `"certified-op/v0"` **exactly** (string equality, not
  prefix/substring — the Zod literal is the authority). A block whose `schema` differs or
  is absent is a **present-but-broken claim → failed-certification**, never dropped.
- **0 operation blocks** → the commit carries no certification (its class is decided by
  whatever else it carries — §6). **exactly 1** → a **certification claim** (must pass
  §3.1). **≥2** → **failed-certification** (a commit is one atomic step).
- **A commit carries a waiver *or* an operation block, never both.** Both fences present →
  **failed-certification** (and, symmetrically, `invalid`): two competing atomic claims
  about one commit, whose verdicts must not be silently reconciled. This is the one
  cross-fence rule; the two mechanisms are siblings, not layers, at the commit level (their
  *conceptual* relationship is §8). **This rule requires a normative edit to `docs/spec.md`
  §17.1's waiver parser** — which today explicitly *ignores* non-`waiver` fences — so that
  it *scans for* co-present ` ```operation ` fences and classifies co-presence as `invalid`.
  The edit is enumerated in the §10 merge plan; until it lands, the "symmetrically invalid"
  half is *aspirational*, and only this doc's parser enforces the rule.
- **Robustness (inherited unchanged):** tolerant of trailing whitespace and CRLF; the
  embedded JSON may **not** contain a ` ``` ` fence (the schema forbids triple-backticks in
  string values); an embedded block **> 64 KiB → failed-certification** (a *parse-side* DoS
  guard only; the *replay-side* bound is the load-bearing one — §5.3 clause 4, §11).
- **The commit *is* the base/head pair:** `base = C^1` (first parent), `head = C`; the
  operation must account for `C`'s **entire** diff by whole-tree equality (§3.1) — a
  certified commit may **not** smuggle an un-accounted change (§4). **Merge commits**
  (≥2 parents) and **root commits** (no parent) are **skipped** (`merge-commit` /
  `root-commit`, §17.1) — never replayed.
- **Stacking is supported** exactly as §17.1: a multi-step mechanical change is a sequence
  of certified commits, each replaying against its own first parent; `verify`/`stamp` walk
  the range in order.

**Split-commits discipline (restates `docs/spec.md` §3.3).** A certified operation must be
**isolated in its own commit** — because certification is *exclusive* (§4), any substantive
edit (a hand-written helper, a config flag, a manifest/lockfile bump) in the same commit
breaks `head == O(parent)`. There is no "hand-edit the tests" escape hatch as there is for
waivers (`change-test`). Any hand-authored or config change belongs in its **own** separate
commit, which gets normal review. This is precisely the discipline the running example must
follow — the shipped `1813494` **violates** it by bundling the `tsconfig`/manifest change
with the codemod, which is why it is `failed-certification` as-is and must be split (§1.1,
§9.4).

**commitlint carve-out (restates `docs/spec.md` §17.4).** Pretty-printed operation JSON
exceeds `body-max-line-length` (100); adopters set `body-max-line-length: [0]`, the same
carve-out the waiver block already requires.

### 5.5 The executor interface (future-proofing the vocabulary)

`rewrite-import-extension` is the first instance of a general family: **structural
find/replace on matched AST node positions** — *"at every node matching selector `S`,
replace text pattern `P` with `Q` by minimal in-place splice."* New executors slot in
behind one interface, so the vocabulary grows without touching the certification core (§3)
or the verdict aggregation (§6):

```ts
interface CertifiedExecutor<P> {
  readonly kind: string;              // closed-vocabulary tag, e.g. "rewrite-import-extension"
  readonly params: ZodSchema<P>;      // parameter schema (drives §5.4 validation & LLM structured output)
  apply(tree: WorkTree, params: P): WorkTree;   // pure, byte-exact fn of (parent tree, params); throws on failure/bound (§5.3)
  describe(params: P, result: ApplyResult): OperationSummary; // loud {pattern, fileScope, matchCount, touchedSites[]} for §7.2
}
```

Contract obligations on every executor: **purity + totality + resource-boundedness**
(§5.3), **byte-exact non-reformatting edits** (§3.2), **deterministic file iteration**
(§5.2), and a `describe` that produces the **loud, legible, site-enumerating** summary §2.1
requires. Registration is the closed-vocabulary gate (§3.1 step 1) — an operation whose
`kind` is not a registered executor is rejected fail-closed. Executors live beside the
reproductive-op engine (`docs/spec.md` §4) and are **version-pinned as one unit with the
tool release** (§5.3 clause 2), so a given tool version replays a given executor
identically everywhere. A mis-scoped executor that touches more than its described
positions is a **tool bug** caught by per-executor unit tests — its output would still be
faithfully certified as *whatever it actually did*, so `describe` matching the executor's
real behaviour is a standing test invariant (§11).

---

## 6. `verify` / `stamp` integration & verdict aggregation

Certification folds into the **same** per-commit classification and range-aggregation as
the waiver (`docs/spec.md` §17.2) rather than adding a command. `verify` already classifies
a commit by scanning its body; it gains one branch: if the commit carries an
` ```operation ` block, run **this doc's §3.1 certification** instead of **`docs/spec.md`
§3.1 waiver stamping**. The fence (§5.4) tells them apart.

### 6.1 The new per-commit classes

`verify` classifies **exactly one** commit. The waiver's classes are unchanged;
certification adds **two** — the full per-commit set becomes:

| Per-commit class | Meaning | Origin |
|---|---|---|
| **stamped** | has a ` ```waiver ` block; it schema-validates and the diff stamps (`docs/spec.md` §3.1) | §17.2 |
| **certified** | has an ` ```operation ` block; it schema-validates and `head == O(C^1)` exactly (§3.1 this doc). A faithful, complete, reproducible account of the diff — **no safety claim**. | **new** |
| **invalid** | has a ` ```waiver ` block that fails to parse/validate or fails to stamp, **or carries both a ` ```waiver ` and an ` ```operation ` fence** (§5.4) | §17.2 (widened) |
| **failed-certification** | has an ` ```operation ` block that fails to parse/validate, whose replay does **not** reproduce head (`head != O(C^1)`), that exceeds the replay bound (§5.3 clause 4), that hits a version-skew (§3.1 step 3), **or** a commit carrying **both** fences | **new** |
| **unwaivered** | no ` ```waiver ` **and** no ` ```operation ` block — a normal commit needing full human review | §17.2 (widened) |

Plus **skipped** — merge (`merge-commit`) or root (`root-commit`) commit, never replayed
(§5.4). `certified` is the new **benign, non-approving** class: like `unwaivered` it does
not lift a PR to APPROVE, but unlike `unwaivered` it *narrows what the human reads* to a
proven-complete operation. `failed-certification` is the new **failed-claim** class: like
`invalid`, a present claim the tool could not confirm.

### 6.2 The full aggregate table for mixed PRs

`waiver stamp --base --head` walks `base..head` and emits the **highest-severity** class
present. Certification slots a new tier — **COMMENT_CERTIFIED** — between `invalid`-driven
REQUEST_CHANGES and the existing COMMENT/APPROVE. The five conditions below **partition the
input space** (they are mutually exclusive and exhaustive), so precedence is a
documentation aid, never a live tiebreak; the downside-bound invariant is preserved
verbatim: **only APPROVE removes review, and certification never grants APPROVE.**

| Aggregate verdict | Condition | Intended GitHub review action |
|---|---|---|
| **REQUEST_CHANGES** | **any** commit is `invalid` **or** `failed-certification` | request changes — a present claim (waiver *or* operation) that fails is a failed claim (mistake or bypass attempt), the one case worth actively flagging |
| **COMMENT** | no failed claim, **≥1** `unwaivered`, **and ≥1** `stamped` **or** `certified` (i.e. an un-automated commit sits alongside at least one vouched/accounted one) | comment — the vouched (`stamped`) and certified commits are accounted for; the plain `unwaivered` ones still need a full human read |
| **COMMENT_CERTIFIED** | no failed claim, **no** `unwaivered`, **≥1** `certified` | comment — *"review these operations, not their diffs"*: every commit is either mechanically safe (`stamped`) or provenance-certified; a human reviews only the listed operations |
| **APPROVE** | **every** commit is `stamped` (≥1 commit; **no** `unwaivered`, `invalid`, `certified`, or `failed-certification`) | approve — the whole PR is mechanically **safe**; no human read needed. Certification alone can never reach here. |
| **ABSTAIN** (no review) | **no** failed claim, **no** `certified`, and **no** `stamped` — i.e. **zero** commits carry a waiver **or** operation block (every commit `unwaivered` and/or `skipped`) | emit nothing — preserves the §1 downside-bounded invariant |

**Partition check (why exactly one row matches every input).** Let a PR's non-skipped
commits induce four counts: `F` (failed: `invalid` ∪ `failed-certification`), `U`
(`unwaivered`), `C` (`certified`), `S` (`stamped`). `F>0` → REQUEST_CHANGES (and only that
row requires `F>0`). Otherwise `F=0` and the remaining rows split on `U` and `C`: `U>0 ∧
(S>0 ∨ C>0)` → COMMENT; `U=0 ∧ C>0` → COMMENT_CERTIFIED; `U=0 ∧ C=0 ∧ S>0` (all `stamped`)
→ APPROVE; and the sole remaining case `U≥0 ∧ C=0 ∧ S=0` (nothing vouched or certified —
every commit `unwaivered`/`skipped`) → ABSTAIN. The previously-ambiguous *all-`unwaivered`*
PR now matches **only** ABSTAIN (it fails COMMENT's "≥1 `stamped` or `certified`" clause),
so the tool stays silent on fully-unautomated PRs instead of posting a content-free COMMENT.

**Severity precedence (orders by review-burden — most-flagged first — NOT by
desirability):**
`REQUEST_CHANGES > COMMENT > COMMENT_CERTIFIED > APPROVE > ABSTAIN`.
Note that the *most desirable* outcomes (APPROVE, ABSTAIN) sit at the **bottom** of this
list: the ordering ranks how loudly the tool flags, not how good the outcome is. Because
the conditions partition the input (above), this ordering never actually breaks a tie; it
is retained to describe the tool's escalation posture, in the `docs/spec.md` §17.2 spirit:

- **A failed claim outranks everything** — `invalid` and `failed-certification` both drive
  REQUEST_CHANGES. A *present, failing* claim (of either kind) is an assertion the tool
  could not confirm; an *absent* claim is merely un-automated (benign). Same logic that
  ranks `invalid` above `unwaivered` in §17.2, extended to provenance claims. A commit that
  says *"this diff is exactly `O`"* and **isn't** is either a mistake (hand-edited after
  replay — e.g. the `1813494` config edits) or a bypass attempt (§4) — either way, flag it.
- **A plain `unwaivered` commit outranks a certified one** — COMMENT (a full human read is
  needed anyway) sits above COMMENT_CERTIFIED (only the operations need reading). Mixing a
  certified commit into a PR that already has an un-automated commit doesn't *reduce* the
  human's job below "read the unwaivered commit," so the verdict stays COMMENT; the report
  still lists the certified operations as a scoping aid.
- **APPROVE is the stronger *outcome* than COMMENT_CERTIFIED** — a fully-`stamped` PR needs
  *no* human read, which is less review than "read only the operations." But APPROVE
  (higher-desirability, lower on the severity list) is **unreachable once any commit is
  merely `certified`**: a single `certified` commit caps the PR at COMMENT_CERTIFIED,
  because a mechanically-reproducible change of *any* semantics is still *"review the op,"*
  not *"auto-accept."* (APPROVE and COMMENT_CERTIFIED are disjoint — APPROVE requires zero
  `certified`, COMMENT_CERTIFIED requires ≥1 — so this pairing never contends in practice.)

**Downside-bound preserved.** COMMENT, COMMENT_CERTIFIED, and ABSTAIN all leave a human in
the loop; the only verdict that *reduces* review is APPROVE, and APPROVE requires **every**
commit `stamped`. Introducing `certified` cannot weaken this. An automation layer that
treated COMMENT_CERTIFIED as approval would be its own bug, not a property of this tool —
the contract (§7.3 / §18.3) fixes it so it can't.

### 6.3 Exit codes

Consistent with `docs/spec.md` §10/§17.2 — `0` success/benign · `1` a real failed claim ·
`2` malformed invocation · `3` internal:

- **`verify [<commit>]`** (default `HEAD`): `0` the commit is **stamped**, **certified**,
  or **skipped** · `1` **invalid**, **failed-certification**, or **unwaivered** · `2`
  unresolvable commit-ish · `3` internal. (A `certified` commit exits `0` — a *satisfied*
  claim, like `stamped`; a `failed-certification` exits `1` — a failed claim, like
  `invalid`. The coarse *"did any claim fail"* gate stays true.)
- **`stamp --base --head`**: `0` verdict ∈ {APPROVE, COMMENT, COMMENT_CERTIFIED, ABSTAIN}
  · `1` REQUEST_CHANGES (**any `invalid` or `failed-certification`**) · `2` malformed
  invocation · `3` internal. A COMMENT_CERTIFIED driven purely by `certified` commits still
  exits `0` — no claim failed; review was narrowed, not removed.

The **verdict** in `--json` is the authoritative signal; the exit code is the coarse
shell-use gate (`docs/spec.md` §10).

### 6.4 Backstop & integrity (inherited)

- **Backstop binds to the verified head** (`docs/spec.md` §3.1 step 6, §17.5). *"tsc clean +
  affected tests green"* on the head SHA is the host CI's gate, confirmed by the automation
  layer — **not** re-run per commit and **not** part of certification (which runs no
  compiler, §3.1). Certified commits do **not** get the reproductive family's
  emit-composition guarantee (they make no emit claim), so the head backstop is the belt
  that catches a certified operation that individually reproduces but leaves the head tree
  red — e.g. a behaviour-changing call-rename (§9.2) that breaks a test surfaces in host CI
  and, correctly, at the COMMENT_CERTIFIED human review.
- **Squash / rebase integrity** (`docs/spec.md` §17.5) applies verbatim. A verdict binds to
  the **exact head SHA** it was computed for. **Squash-merge** discards the certified
  commits → the squashed commit carries no operation block → **unwaivered** → normal review
  (review-scoping simply doesn't apply; nothing unsafe was auto-approved, because
  certification never auto-approves). **The only reliable way to keep a certification
  through a merge is merge/rebase-merge so the verified commits land as-is** (the README's
  supported merge mode). The "have the squashed commit itself carry an operation block"
  escape hatch is **viable only when the entire PR is a single operation with no other
  commits**: a realistic PR squash *combines* the certified codemod with the deliberately
  separate substantive commits (§9.4), and one operation block cannot reproduce
  codemod-output *plus* hand-written edits — by §4 exclusivity that squashed commit is
  **`failed-certification` → REQUEST_CHANGES**, which is *worse* than the benign
  `unwaivered` fallback. So squash **defaults to dropping the claim** (`unwaivered`, normal
  review); teams that want to preserve certification use merge/rebase-merge. A **force-push**
  after verification → new head SHA → a fresh `stamp` on the SHA that will merge. **Stale
  verdicts are never reused.**

---

## 7. CLI & report

### 7.1 Commands

Certification reuses the **existing** binary and subcommands (`docs/spec.md` §10) — no new
top-level command, because `verify`/`stamp` already read the commit's embedded block and
now recognise the ` ```operation ` fence alongside ` ```waiver `.

```
waiver apply   <file>                            # (dispatch on root schema) applies a waiver OR an operation file to the working tree
waiver verify  [<commit>] [--json]               # classify one commit (stamped | certified | invalid | failed-certification | unwaivered | skipped)
waiver stamp   --base <ref> --head <ref> [--json] # aggregate the PR verdict over base..head
```

**Authoring aid — `waiver apply` learns operation files, dispatching on `schema`.** For
symmetry with the waiver flow (§17.4), `waiver apply` **dispatches on the file's root
`schema` literal**: `"waiver-stamp/v0"` → apply the waiver's transform ops (existing
behaviour); `"certified-op/v0"` → run the operation's executor over the working tree; a
file whose `schema` matches **neither** is a **malformed-file error** (exit `2`, per §6.3 /
`docs/spec.md` §10). As with the waiver flow, `apply` is a working-tree mutation and expects
a clean tree; nothing is hand-edited (§5.4 split-commits discipline). No `certify`
subcommand is introduced — the concept folds into the existing `apply` / `verify` seam (the
same reason `docs/spec.md` §17.4 removed the former `waiver commit`).

**Authoring flow** (mirrors §17.4, three steps):

1. **`waiver apply <operation-file>`** — run the executor over the working tree; nothing is
   hand-edited (§5.4 split-commits discipline).
2. **Write a normal commit** with the ` ```operation ` block in the body, **before any
   trailer paragraph** (`Refs:`, `BREAKING CHANGE:`) so `semantic-release` and other
   trailer consumers still read the footer last; `verify` is placement-agnostic. Goes
   through the normal linted `commit-msg` hook path.
3. **`waiver verify`** (no arg → `HEAD`) — replays the operation over `C^1` and confirms
   `head == O(parent)` **locally, one command after committing** — the identical
   computation `stamp` runs on push. On failure: fix the operation, `apply` again, and
   amend the commit (re-embedding the block).

### 7.2 Report shape

`--json` extends the `docs/spec.md` §17.3 report. The per-commit record gains an
`operation` summary for `certified` / `failed-certification` commits, and the aggregate
`verdict` may be `COMMENT_CERTIFIED`. **All numeric fields (`filesTouched`,
`matchesRewritten`) and the `touchedSites` / `outOfScope` lists are *actual outputs of the
replay* the verifier ran — never asserted; the sample below is illustrative and must be
regenerated from a real `waiver verify` of the codemod-only commit before it is quoted as
truth** (per the repo's benchmark-figures rule):

```jsonc
{
  "verdict": "COMMENT_CERTIFIED",
  "commits": [
    {
      "sha": "<codemod-only commit>",
      "subject": "rewrite relative .js import specifiers to .ts",
      "class": "certified",
      "operation": {                          // present iff class ∈ {certified, failed-certification}
        "op": "rewrite-import-extension",
        "description": "rewrite relative .js import specifiers to .ts",  // the LOUD, LEGIBLE §2.1 payload
        "from": ".js", "to": ".ts", "scope": "relative",
        "filesTouched": 34,                   // actual replay output (src + scripts .ts files)
        "matchesRewritten": 112,              // actual replay output; the "did it reach where I didn't expect?" signal
        "touchedSites": [                      // ENUMERATED per-site, so scope-broadening is visible (§2.1, §4)
          "src/cli.ts: './load.js' -> './load.ts'", "…" ],
        "outOfScope": {                        // informational provenance — NOT an exclusion phase (§3.1 step 6, §8)
          "nonRelativePackageSubpaths": ["@modelcontextprotocol/sdk/*.js (published .js entry point)"],
          "relativeStringsNotSpecifierNodes": ["src/engine/ops/move-file.test.ts: fixture source string './orders.js'"]
        },
        "executorVersion": "certified-op@<exact> (ts-morph <exact>, typescript <exact>)"  // §5.3 clause 2
      },
      "reasons": [],
      "uncoveredFiles": []                     // populated on failed-certification: paths where O(base) != head (the smuggled-edit evidence, §4)
    }
  ]
}
```

**The report is where the §2.1 social failure mode is fought.** The automation layer maps
a `certified` commit onto a GitHub **COMMENT** whose body is the operation summary —
*"Review the operation, not the diff: `rewrite-import-extension .js→.ts (relative)` — 112
specifiers across 34 files; package subpaths (`@modelcontextprotocol/sdk/*.js`) and relative
`.js` **strings that are not specifier nodes** (test fixtures) deliberately untouched."* —
rendered above a collapsed diff so reading the operation is visibly cheaper than expanding
it. It **never** maps onto an APPROVE. The **description, file scope, match count, and the
enumerated touched-site list** are mandatory in that note; a report that hid the match count
or the per-site list would defeat its own purpose (§2.1). The `outOfScope` object is
**informational provenance** about what the structural scope did *not* match — it is
**not** an exclusion set (certification has **no** exclusion phase, §3.1 step 6 / §8), and
its two sub-lists deliberately distinguish *non-relative package subpaths* from
*relative-looking strings that are not specifier nodes*, so a reviewer can reconcile any
un-rewritten relative `.js` string. For a `failed-certification` commit, `uncoveredFiles`
lists exactly the paths where the author's diff diverged from `O` — the smallest sufficient
thing for the author to fix (for the shipped `1813494` this would be `package.json`,
`pnpm-lock.yaml`, `tsconfig.json`).

---

## 8. Relationship to waivers — the unification

Certification is not a sibling *bolted on* — it is the **more fundamental primitive**, and
a waiver is a special case of it. State the unification precisely.

> **A waiver is exactly a certified operation that ADDITIONALLY passes the
> emit-equivalence proof (`docs/spec.md` §7) and the static guards (`docs/spec.md` §8).**

The runner's `apply`/`fold` seam already *reproduces* a transform and produces the tree `O`
(`docs/spec.md` §3.1 step 3 "Fold"; §4 "Runner"). Two things can then be asked of `O`:

```
                 reproduce O = fold(parent, ops)          ← the shared seam (docs/spec.md §3.1 step 3; §4 Runner)
                 ├── certified :  O == head   (tracked bytes)  ← this doc — the base primitive
                 └── stamped   :  emit(O) == emit(head)        ← docs/spec.md §7  (tokenised emit)
                                  AND static guards pass        docs/spec.md §8
```

A stamp is a certification with **three extra, behaviour-focused refinements bolted on
top**: (1) it compares **tokenised emit** instead of tracked bytes, so
formatter/comment/type-only drift is *forgiven* (§7) — precisely the looseness
certification *refuses* (§3.2), because the waiver's job is *same behaviour* while
certification's is *same diff*; (2) it runs the **static guards** (§8) that close the emit
path's blind spots; (3) it applies the **exclusion phase** (`docs/spec.md` §6.2) to drop
provably-non-shipping files. Strip all three and you are left with the bare certification.

| | certified-op | waiver |
|---|---|---|
| **Core check** | replay `O`, then `O(base) == head` (tracked bytes) | replay ops, then **emit of** `O(base) == emit of` head (tokenised) |
| **Extra obligations** | none | static guards (§8), dynamic-reference scan, emit-divergence guard, confinement predicates |
| **Claim** | *this diff is exactly `O`* (provenance) | *this diff changes no production behaviour* (safety) |
| **May be behaviour-changing?** | **yes** | **no** |
| **Best verdict** | COMMENT_CERTIFIED (*review the op*) | APPROVE (*no review*) |
| **Needs a compiler?** | **no** — literal tree diff | **yes** — compiler emit |

So: **certified-op is the primitive; waiver is certified-op + emit-proof + guards +
exclusion.** Everything a waiver stamps, a certified-op could *also* certify (faithful
provenance) — but a waiver certifies **more** (safety), which is why it earns the stronger
APPROVE. Everything a **behaviour-changing** operation can certify, a waiver **cannot**
stamp — the reach certified-op adds is exactly the set of *"reproducible but not
behaviour-preserving"* changes (§9.2), plus everything the emit engine can't model at all
(§9.3).

**This doc stays self-contained.** Certification is defined without reference to emit
(§3), so it can certify changes the emit engine can't model. The unification is the *why it
fits* — a lens on how the two relate, not a dependency of the mechanism.

---

## 9. Worked examples

Lead with the running example (in its honest split form); then a behaviour-changing case
and a non-TS case — the two reaches a waiver structurally cannot have — and restate the
split-discipline case.

### 9.1 (lead) — the `.js → .ts` import-extension rewrite (reproducible, type-surface-changing), split

- **The shipped commit `1813494` does not certify as-is.** It bundles the codemod with a
  `package.json`/`pnpm-lock.yaml` TS-floor bump and a `tsconfig.json` flag flip
  (`rewriteRelativeImportExtensions: true`) — three edits the specifier-rewrite executor
  does not produce. `head = O(base) + e` (`e` = those three files) → `head != O(base)` →
  **failed-certification** (§4, §11). This is the mechanism refusing to launder a
  behaviour-relevant flag flip into a mechanical sweep — not a defect in the example.
- **The required split (§9.4):**
  - **Commit A** — TS floor bump + `tsconfig` flag. Enabling the flag changes emitted
    `.d.ts` specifiers `.js → .ts` (type-surface change), so it is a **behaviour-relevant
    decision** → normal review (unwaivered), or waiver `bump`/config ops where applicable.
    *Not certifiable as a specifier rewrite, because it isn't one.*
  - **Commit B** — the codemod alone: **112 relative specifiers across 34 `.ts` source
    files** (`src/` + `scripts/`), nothing else.
- **Why Commit B isn't cleanly waiverable either:** even isolated, it is
  runtime-emit-identical but **type-surface-different** (emitted `.d.ts` specifiers change),
  so the §7 emit comparison diverges → a reproductive waiver **FAILs**. It sits in the gap
  between provably-safe and manual-diff.
- **Certified-op (Commit B):**
  `rewrite-import-extension { from: ".js", to: ".ts", scope: "relative" }`. Replay over
  Commit B's parent reproduces all 112 specifiers **and** leaves untouched (i) the four
  `@modelcontextprotocol/sdk/*.js` package subpaths and (ii) the relative `.js` strings in
  test fixtures that are not specifier nodes (§5.2). `O(base) == head` byte-for-byte →
  **certified** → COMMENT_CERTIFIED. Reviewer reads **one operation** and a count of *112
  across 34 files* (plus the enumerated site list, §7.2), not 112 line pairs. Had the author
  hand-edited an unrelated line, tree equality breaks → **failed-certification** →
  REQUEST_CHANGES (§4).

### 9.2 (behaviour-changing) — `oldCall( → newCall(` at all call sites (reproducible, NOT safe)

- **Change:** replace every call to `oldCall(` with `newCall(` across a module —
  *behaviour-changing* (a different function runs).
- **Why no waiver — ever:** a waiver's reproductive family asserts *no behaviour change*
  (`docs/spec.md` §2); this changes behaviour, so a waiver's emit comparison would
  (correctly) FAIL. Not a heuristic gap — a **categorical** one; a waiver legally cannot
  express it.
- **Certified-op:** a structural find/replace executor (§5.5) scoped to `CallExpression`
  callee positions named `oldCall`. Replay reproduces every rewritten call site; if the
  author *also* changed one call's arguments by hand, that line is in `head` but not in
  `O(base)` → `head != O(base)` → **failed-certification** (§4 exclusivity). Certified
  means: *the diff is exactly this call-rename, nothing else.* The reviewer's unit is the
  **one behavioural decision** — *is `newCall` the right target?* — confirmed to apply at
  exactly the sites the operation names (enumerated in the report), instead of auditing
  every site for a smuggled edit. If `newCall` breaks tests, the head backstop (§6.4) fails
  and the human sees it. **This is the reach a waiver cannot have.**

### 9.3 (non-TS) — a config-key rename no compiler can model

- **Change:** rename the config key `retryCount → maxRetries` across `*.yaml` / `*.json`
  files (and a markdown table reflow).
- **Why no waiver:** the emit engine models **TypeScript emit** only; it cannot model
  YAML/JSON/markdown at all (`docs/spec.md` §7 is a tsc-emit comparison). Categorically
  outside the waiver machinery.
- **Certified-op:** a structural key-rename executor over the parsed config tree (§5.5).
  Replay re-parses each file, renames the key, re-serialises **the touched key span only**
  (§3.2 — no whole-file reflow), and compares the resulting **tree** (§3.1 — tree equality,
  no compiler). A `"retryCount"` appearing inside a string *value* is left alone (the
  executor is confined to *key* nodes) — and certification proves it. If serialisation is
  deterministic and byte-exact (§5.3 clauses 1, 3), the commit certifies exactly. This is
  the clearest demonstration that certification is **not a weaker waiver but a different,
  broader primitive**: it reaches files the emit engine cannot see, precisely because it
  never needs emit. (§13 Q3 — raw-bytes vs. git-normalised EOL — must be decided **before**
  this first non-TS executor ships, since YAML/JSON EOL policy varies by repo.)

### 9.4 (split discipline) — operation + a smuggled tweak

Suppose an author wants the §9.1 rewrite **and** to hand-write one helper (or, as in the
real `1813494`, **and** to flip a `tsconfig` flag). They **cannot** put both in one commit:
the helper / flag is an `e` that breaks `head == O(base)` → the combined commit is
**failed-certification** (§4). The required — and intended — shape mirrors `docs/spec.md`
§3.3:

- **Commit A** — the substantive/config change alone → **unwaivered** → normal human review.
- **Commit B** — the certified operation alone → **certified** (COMMENT_CERTIFIED: read the
  op).

The mechanical churn is scoped away from the substantive change **by construction**; the
reviewer reads the helper/flag in isolation and the rewrite as one sentence. The shipped
`1813494` is exactly a PR that *should* have been authored this way.

---

## 10. How this doc merges into `docs/spec.md`

A concrete merge plan, so the sibling relationship is actionable:

- **§1 / §1.1 (trust posture)** — add §2 (this doc) as a subsection *"provenance, not
  safety,"* beside the existing *"this is not a proof."* The two postures are parallel:
  waiver = *likely-safe, re-verifiable*; certified = *exactly-this-diff, replayable*.
- **§2 / §3 (safety model, everything-is-an-operation)** — reframe around §8's unification:
  introduce the shared `reproduce O` seam, then present **two verdict tiers**
  (certified / stamped) over it. Certified-op becomes a fourth **operation posture** beside
  Reproductive / Transitive / Confinement — the one that reproduces *any* semantics and
  compares by bytes. **Assign this doc's §3.1 and `docs/spec.md` §3.1 distinct section
  numbers** so the two principles no longer collide (§3.1 note, this doc).
- **§4 (Runner)** — the verifier already *is* the runner's verification mode; add the
  tree-equality comparison alongside the emit comparison, and register the
  `CertifiedExecutor` interface (§5.5) beside the reproductive-op engine.
- **§5.1 (op vocabulary)** — the executor set joins the closed vocabulary. Note the
  precedent chain explicitly: `lint-fix` (tool-reproducible, behaviour-*changing* by
  policy) is the bridge from reproductive ops to certified-op executors. Pin ts-morph /
  TypeScript to **exact** versions in the tool release (§5.3 clause 2), replacing the
  current `^` ranges.
- **§8 / §9 (guards & determinism)** — §8's guards **do not apply** to certified-ops (they
  shore up the emit path's blind spots, which certification doesn't use); §9's determinism
  contract applies **and gains four clauses** (this doc §5.3): executor purity, exact
  version-pinning, byte-exact non-reformatting edits, and the resource-bounded replay.
- **§17 (commit-embedded & verdicts)** — add the ` ```operation ` block (§5.4) beside
  ` ```waiver `, the `certified` / `failed-certification` classes and the
  `COMMENT_CERTIFIED` verdict (§6) into the §17.2 tables, and the §6.4 integrity notes into
  §17.5. **Normative edit to §17.1's parser (required, not optional):** the waiver parser —
  today documented to *ignore* non-`waiver` fences — must additionally **scan for
  co-present ` ```operation ` fences and classify a commit carrying both as `invalid`**, so
  the §5.4 both-fences rule is symmetric. Without this edit, a waiver+operation commit
  classifies as a clean single-`waiver` `stamped` commit under the unmodified §17.1, which
  the both-fences rule forbids.

The doc is **self-contained today** and **forward-compatible**: the schema string
`certified-op/v0` is versioned independently of `waiver-stamp/v0`, so the two blocks can
evolve on separate cadences even after they share a spec. Once both tiers ship, factor the
shared **replay** core so `stamp` runs certification (tree diff) and, for waivers, layers
emit-compare + guards + exclusion on top (§8) — one engine, two verdict strengths.

---

## 11. Security & adversarial analysis

Certification's guarantee is `head == O(parent)` under a **closed, pinned, pure,
resource-bounded** executor set (§5). The adversary is an author who *authors the operation
block* and wants to slip an un-reviewed change past a reviewer who trusts the
` ```operation ` note, **or** to weaponise the replay against the reviewer's machine. Every
path is fail-closed.

- **Smuggle an out-of-band edit alongside `O`** — the primary attack (*"bury one line in
  mechanical churn"*; concretely, the `tsconfig`/manifest edits bundled into `1813494`).
  **Defeated by §4:** the extra edit is the `e` that breaks tree equality →
  `head != O(base)` → **failed-certification** → REQUEST_CHANGES. The forced-complete
  property *is* the anti-smuggling property; this is closed by construction.
- **Omit a site `O` would produce** (hand-revert one rewrite to keep old behaviour
  somewhere). Symmetric: `O(base)` contains the site, `head` does not → inequality →
  **failed-certification**. The author can neither under- nor over-apply.
- **Author-controlled executor (`{"op":"script"}`)** — **structurally impossible.** The
  vocabulary is closed (§5.1); an unknown `op` fails the vocabulary gate (§3.1 step 1).
  There is no path by which certification runs author-supplied code — both a code-execution
  defence (only tool-shipped executors run) and a reproducibility defence (no host drift).
- **Malicious operation *parameters*** — a legitimately-typed pattern crafted to match far
  more (or a different set of) sites than the reviewer pictures, so the *one reviewed line*
  hides intent inside a valid parameter (§2.1). **This is the residual §4 does NOT close:**
  §4 proves *diff == `O(params)`*, not *`O(params)` == the reviewer's mental model*. It is a
  **judgement** risk that can degrade the review-scoping *value* (not the soundness), and it
  is fought on the report surface, not in the proof: §7.2 makes the **enumerated
  touched-site list**, file scope, and match count mandatory, so an operation claiming
  *"rewrite `.js`→`.ts`"* that quietly touched a security-relevant specifier is visible
  **per site**, not hidden behind a bare count. The irreducible remainder is the §2.1 social
  failure (reviewer doesn't read `O`) — named, bounded, pushed onto the loudest surface.
- **Executor non-determinism** (buggy executor reading env/ordering/locale, or a
  serialiser that reflows untouched bytes — §3.2/§5.3 clause 3). **Degrades to a false FAIL,
  never a false certification** (§5.3): if replay diverges on the verifier's machine,
  `O(base) != head` → **failed-certification**. An attacker can only *lose* a certification
  this way, never *gain* one. (Any executor observed to read wall-clock/env/network/locale
  or to reprint untouched regions is a **bug to fix**; §5.3 makes purity + byte-exactness a
  contract, not a hope.)
- **Executor version skew** — a verifier running a different ts-morph/TS than the author,
  producing byte-different trees for the same operation. **Closed by exact pinning +
  version-compat gate:** engines are pinned to exact versions in the tool release (§5.3
  clause 2), and §3.1 step 3 **fails closed** when the verifier's executor version is
  incompatible with the version the block binds (§13 Q2). Skew degrades to
  **failed-certification**, never a divergent silent pass.
- **Replay-cost DoS against the reviewer's machine** — the real cost centre. A **tiny,
  well-formed** block run against an attacker-crafted PR branch with a pathologically large
  or deeply-nested source tree forces a full ts-morph program load on the reviewer's / CI
  machine; the `> 64 KiB` *block* guard (§5.4) does nothing here because replay cost scales
  with the **repo tree**, not the block. **Closed by the §5.3 clause 4 replay bound:** a
  wall-clock / memory / file-count cap on the replay, exceeding which is
  **failed-certification** (fail-closed), not an OOM/timeout crash. Certification runs
  against **untrusted PR content**, so the bound is on the replay, not just the block.
- **Fence confusion — pass a provenance claim off as a safety claim.** **Defeated at the
  parser (§5.4):** the fence is self-identifying; an ` ```operation ` block can only ever
  produce `certified` / `failed-certification` (never `stamped`), so it can never reach
  APPROVE. Carrying **both** fences is `failed-certification` / `invalid` (the §10 §17.1
  parser edit makes the waiver side symmetric). There is no verdict path from a certified
  operation to APPROVE.
- **Squash / rebase / force-push to launder a stale verdict.** **Defeated by §6.4 /
  `docs/spec.md` §17.5:** verdicts bind to the exact head SHA; a merged tree carrying no
  operation block is `unwaivered` → normal review; a squashed commit that *does* carry an
  operation block but combined codemod + hand edits is `failed-certification` (§6.4); a
  post-verification force-push forces a fresh `stamp`. Stale verdicts are never reused.
- **Oversized / malformed block** — `> 64 KiB` or a fence-containing payload is
  **failed-certification** (§5.4) at parse time, never handed to the replay.

**Net posture.** Every adversarial path lands in `{failed-certification (REQUEST_CHANGES),
unwaivered (normal review), skipped}` — **never** in a spurious APPROVE and never in *"less
review than today."* The two irreducible residuals are (a) the **human who doesn't read the
operation** and (b) the **legitimately-typed parameter that hides intent** (§2.1) —
mitigated by making the operation, its file scope, its match count, and its **enumerated
touched sites** the loudest, cheapest thing in the report, and stated here rather than
hidden.

---

## 12. Out of scope (v0) & roadmap

**Out of scope for v0:**

- **Executors beyond `rewrite-import-extension`.** The general structural find/replace
  family (§5.5) — `oldCall → newCall`, JSX prop renames, config-key renames — and non-TS
  format executors (§9.3) are designed-for but not shipped.
- **Arbitrary / script executors** — permanently out (§5.1); not a roadmap item.
- **Multiple operations per commit.** v0 is one atomic `operation` (§5.4); a compose form
  (`ops[]` folded in order) is deferred (§13 Q1). Compose mechanical steps as a **stack** of
  certified commits, not a list within one.
- **Certifying against a non-parent base** — `base = C^1` only (§5.4).
- **Any safety inference** — certification is deliberately silent on semantics; do **not**
  add heuristics that nudge a certified commit toward APPROVE — that would collapse the
  provenance/safety boundary (§2, §8) the whole design rests on.

**Roadmap.**

1. Ship `rewrite-import-extension` (v0) with exact-pinned ts-morph/TS (§5.3), byte-exact
   in-place splicing (§3.2), deterministic file iteration (§5.2), and the replay bound
   (§5.3 clause 4) — the single-executor MVP that pays for itself on the codemod-only
   Commit B of the running example.
2. Generalise to **structural find/replace on matched AST node positions** (§5.5),
   subsuming the specifier rewrite and reaching the behaviour-changing call-rename (§9.2).
3. Add **non-TS structural executors** (config-key rename, markdown reflow, §9.3), each
   pure, byte-exact, and version-pinned — the reach the emit engine structurally cannot
   have. (Blocked on the §13 Q3 raw-bytes-vs-git-normalised decision.)
4. A **`refactor-with-certified-op` skill** — an analogue of `refactor-with-waiver`
   (`docs/spec.md` §18.2) that teaches an LLM to emit a certified operation for a
   mechanical, possibly-behaviour-changing sweep, and to **split** substantive/config edits
   into their own commit (§9.4) so the mechanical churn certifies clean.
5. Fold the `certified` class and `COMMENT_CERTIFIED` verdict into the automation layer's
   GitHub-comment mapping (`docs/spec.md` §18.3), including the mandatory enumerated
   touched-site rendering (§7.2).
6. **Unification refactor** — factor the shared replay core so one engine serves both
   verdict tiers (§10), and land the §17.1 both-fences parser edit.

---

## 13. Open questions

1. **Composition of operations.** Should a commit be allowed a *sequence* of certified ops
   (`operations: [ … ]`), folded in order like transform ops (`docs/spec.md` §2)? It would
   broaden reach but reintroduce order-sensitivity and a larger block. v0 says one op, one
   commit; leaning *keep single, compose via stacked commits* (§9.4).
2. **Executor version binding — in the claim, or only in the report? (Was unresolved;
   §2/§3.1/§5.3 now depend on a resolution, so this must be decided before shipping.)** §5.3
   pins engines to exact versions in the **tool** release and records the version in the
   report; §3.1 step 3 fails closed on an incompatible verifier version. **Open:** should
   the embedded block additionally bind a **minimum/exact executor version** (so an old tool
   can't silently mis-replay a newer operation shape, and a newer tool knows the exact
   version to reproduce under), or is *"replay under the verifier's pinned version, fail
   closed on skew"* sufficient? Leaning **bind a minimum executor version in the block**
   plus the fail-closed compat gate — but the exact skew rule (minimum vs. exact match,
   forward vs. backward compat) needs a decision. **This is a genuine design decision, not a
   defect to paper over.**
3. **Raw-bytes vs. git-normalised equality (§3.2).** Should tree equality run over raw bytes
   or git's normalised (EOL / `.gitattributes`-applied) content? Raw is stricter and simpler
   to reason about; git-normalised matches *what actually lands* in the merged tree. Needs a
   decision **before the first non-TS executor** (§9.3), where EOL policy varies by file
   type and repo. **Genuine decision.**
4. **Match-count / file-scope thresholds.** Should the report *warn* (not fail) when an
   operation's blast radius exceeds a configurable bound, to push harder against the §2.1
   social failure — or does any threshold invite the *"just under the line"* game? Leaning
   *surface the numbers **and the enumerated site list** (§7.2), set no hard threshold*
   (thresholds are policy, not mechanism), but adopters may want a lever. The §2.1 loudness
   requirement already caps expressiveness: any parameter whose effect can't be summarised
   in one legible line **and** enumerated per site is a smell.
5. **Should `certified` ever compose with `stamped` to lift a verdict?** Firmly **no** in
   v0 (§6.2) — a certified commit caps the PR at COMMENT_CERTIFIED. Is there a future tier
   where a *proven-behaviour-preserving* executor (one that additionally passes the §7 emit
   compare) auto-promotes a `certified` commit to `stamped`? That is precisely the §8
   unification made dynamic — and the intended answer is *that would just be a waiver*.
   Deferred until the executor set is richer.
6. **Interaction with `lint-fix` (`docs/spec.md` §6.1).** A certified specifier rewrite
   leaves imports unsorted; the follow-up sort is a separate concern. Must the sort always
   be its own commit (§9.4), or is a `rewrite-then-normalise` executor pair worth a designed
   seam? (Whichever, the normalise step must be byte-exact and deterministic per §3.2/§5.3.)
7. **Replay resource-bound values (§5.3 clause 4).** The bound is *required*; the concrete
   caps (wall-clock seconds, memory ceiling, max file count / program size) are unset. They
   trade robustness on huge legit repos against DoS protection and need calibration against
   real repo sizes — measured, not asserted. **Genuine tuning decision.**
