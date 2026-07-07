# ESLint support for `lint-fix`

**Status:** approved design
**Date:** 2026-07-07

## Motivation

`lint-fix` (spec §6.1) folds the repo's own committed linter's safe fixes over the
transformed base. v0 ships **Biome only** — `resolveLinter` hardcodes `@biomejs/biome`.
The spec already names the next step: "the linter-resolution seam takes ESLint next"
(§18, "Later"). This design extends that seam to ESLint without touching the op's
schema, the CLI, or the fold pipeline.

## Scope

In scope: the linter-resolution seam and its tests.

- No schema change — `lint-fix` still names files only (`{ op, files }`).
- No new op, no new CLI surface, no fold-order change.
- ESLint's autofixer determinism is **not** engine-owned (spec §9): it is an assumed
  third-party property, bounded like the dependency-bump registry trust. We test what
  the engine owns (detection, resolution, invocation, changed-file detection), not
  ESLint's fix output.

## Design

### 1. `resolveLinter` — multi-linter with fail-closed ambiguity

`src/engine/ops/lint-fix.ts`, `resolveLinter(cwd, toolchainRoot)`.

Detect which of the supported linters the folded tree's manifest declares
(`@biomejs/biome`, `eslint`):

- **Zero declared** → `OpApplicationError('lint-fix', ...)`. Message updated to list
  both supported linters. (Behaviour unchanged; wording widened.)
- **Both declared** → `OpApplicationError('lint-fix', 'both @biomejs/biome and eslint
  are declared; the committed toolchain is ambiguous')`. The op assumes a single
  committed linter (§6.1, "the linter named in the checked-out manifest"); two is
  unprovable intent, so it FAILs closed (§9). There is no per-op linter field to
  disambiguate today, by design — ambiguity is a review signal, not a silent pick.
- **Exactly one** → resolve its binary from `[toolchainRoot, cwd]` (unchanged
  `resolveBin`) and return the descriptor:
  - Biome → `{ bin, args: ['check', '--write'] }` (unchanged; `--unsafe` still omitted
    so only safe fixes land).
  - ESLint → `{ bin, args: ['--fix'] }`. `--fix` is ESLint's safe autofix; ESLint has
    no `--unsafe` analog to omit. Files are appended positionally by the existing
    `runLinter`, exactly as for Biome.

A declared-but-unresolvable binary FAILs closed as today (run the install).

### 2. `runLinter` — unchanged

Keep ignoring all numeric exit codes. ESLint exit 1 (lint remains) and exit 2 (fatal:
bad/missing config, invalid option) both land no unwanted fix. A fatal that lands
nothing degrades to `O ≠ head` → mismatch → review — never a false stamp. Only a spawn
failure (no numeric `status`) FAILs closed. The shared code already does exactly this;
no change.

### 3. Tests

`src/test-helpers.ts` — new fixtures:

- `FIXTURE_ESLINT_PACKAGE_JSON` — a `package.json` declaring `eslint` (and nothing else)
  so the manifest check selects ESLint.
- A minimal flat `eslint.config.js` string (committable) — present for realism; the stub
  does not read it, but the fixture mirrors a real ESLint checkout.
- A helper that writes a **stub `eslint` executable** into the fixture's own
  `node_modules/.bin/eslint` and marks it executable. `resolveBin` searches
  `[toolchainRoot, cwd]`, and the fixture cwd holds the stub, so no waiver-stamp devDep
  is needed — which is what keeps waiver-stamp's **own** manifest Biome-only and avoids
  tripping the new both-declared ambiguity rule on this repo itself. The stub is a small
  node script that honors `--fix <files...>`, applies one deterministic edit to each
  named file, and exits 0 — validating the exact argv the op constructs.

`src/engine/ops/lint-fix.test.ts` — new cases:

- ESLint stub fix lands and the changed file is reported.
- Named files already clean → `changed` is `[]`, content untouched.
- **Both `@biomejs/biome` and `eslint` declared → FAILs closed** with `OpApplicationError`.
- Existing Biome cases stay green (regression guard on the shared path).

### 4. Docs

- `docs/spec.md` §6.1: note ESLint is supported alongside Biome; state the both-declared
  ambiguity as a named fail-closed rule.
- `docs/spec.md` §18 ("Later"): remove the now-shipped "ESLint support for `lint-fix`"
  bullet.
- `README.md`: update the `lint-fix` linter enumeration (Biome → Biome/ESLint) if it
  lists supported linters.

## Non-goals

- Real-ESLint autofix validation (assumed third-party property, §9).
- A per-op linter selector to resolve both-declared trees (ambiguity is intentional).
- ESLint exit-2 special handling (Q3: keep ignoring numeric exits; false FAIL, never
  false stamp).

## Testing strategy

Unit tests via the stub `eslint` binary in the fixture. The stub exercises detection →
resolution → `--fix <files>` invocation → flush/reload → changed-file detection. Real
ESLint behaviour is out of scope per §9.
