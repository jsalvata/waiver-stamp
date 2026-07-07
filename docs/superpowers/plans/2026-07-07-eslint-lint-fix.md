# ESLint support for `lint-fix` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `lint-fix` op's linter-resolution seam so it drives ESLint as well as Biome, failing closed when a tree declares both.

**Architecture:** Replace the single hardcoded Biome linter in `resolveLinter` with a small table of supported linters (`{pkg, bin, args}`) and a select-from-table step. Prep PR table-izes with Biome only (behaviour-preserving); feature PR adds the ESLint row and the both-declared ambiguity throw. ESLint's autofix determinism is an assumed third-party property (spec §9), so tests exercise the engine's seam via a stub `eslint` binary written into the fixture — not real ESLint.

**Tech Stack:** TypeScript, ts-morph, vitest, Node child_process. Linters: `@biomejs/biome` (`biome check --write`), `eslint` (`eslint --fix`).

## Global Constraints

- Fail closed (spec §9): any unresolved/ambiguous linter throws `OpApplicationError('lint-fix', …)` — a stamp is never produced on doubt.
- `runLinter` keeps ignoring all numeric exit codes (Q3): exit 1/2 both land no unwanted fix; only a spawn failure (no numeric `status`) fails closed. **No change to `runLinter`.**
- No schema/CLI/fold-order changes — `lint-fix` still names files only.
- ESLint `--fix` is the safe autofix; no `--unsafe` analog exists to omit (mirrors Biome omitting `--unsafe`).
- waiver-stamp's own manifest must stay Biome-only — do **not** add `eslint` to the repo's `devDependencies`, or this repo would trip its own both-declared rule. Tests get ESLint from a stub bin in the fixture.
- Commits: invoke the `git-commit` skill. Per the no-work-hours-commits rule, no commit may bear a Mon–Fri 09:00–18:00 (+0200) timestamp — shift author/committer dates outside that window (or defer).

## PR Plan

Reasoning order: feature spike → prep → cleanup. Ship order: 1 → 2 → 3.

- **PR 1 — Prep refactor** (`prep-eslint-lint-fix` off main): table-ize `resolveLinter` with Biome as the only entry.
  Removes friction: the linter identity is hardcoded in three coupled places (manifest check, bin name, args), so a second linter (ESLint) can't be slotted in — a `SUPPORTED_LINTERS` table + select-single makes the feature a one-row addition.
- **PR 2 — Feature** (`eslint-lint-fix` off prep): add the ESLint row, the both-declared ambiguity throw, tests via a stub `eslint`, and docs.
- **PR 3 — Cleanup refactor:** *Skipped — the feature leaves no dead branches, dup, or now-stale names; the table absorbs the ESLint row cleanly and docs are updated in PR 2.*

Candidate prep for next time: when a third linter is added, the table already exists — no new prep expected; the only recurring question is the ambiguity policy, now settled.

Branches (git-branch skill, GitHub username `jsalvata`; personal repo, no ticket): `jsalvata/prep-eslint-lint-fix`, then `jsalvata/eslint-lint-fix` stacked off it.

---

## PR 1 — Prep refactor: table-ize `resolveLinter`

Behaviour-preserving. The existing Biome tests are the safety net; **no new test logic** in this PR.

### Task 1: Introduce `SUPPORTED_LINTERS` and select-from-table

**Files:**
- Modify: `src/engine/ops/lint-fix.ts` (`resolveLinter`, lines ~67-97, and the `Linter` interface region)
- Also commit (documentation): `docs/superpowers/specs/2026-07-07-eslint-lint-fix-design.md`, `docs/superpowers/plans/2026-07-07-eslint-lint-fix.md`

**Interfaces:**
- Consumes: existing `manifestDeclares(cwd, pkg)`, `resolveBin(name, roots)`, `OpApplicationError`.
- Produces: `interface LinterSpec { pkg: string; bin: string; args: readonly string[] }`; `const SUPPORTED_LINTERS: readonly LinterSpec[]`; `resolveLinter(cwd, toolchainRoot): Linter` (unchanged signature/return).

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `pnpm test`
Expected: PASS (all existing tests, including the 4 in `lint-fix.test.ts`).

- [ ] **Step 2: Add the `LinterSpec` type and the single-entry table**

In `src/engine/ops/lint-fix.ts`, just above the existing `Linter` interface, add:

```ts
/**
 * A linter `lint-fix` knows how to drive: the manifest package that declares it, its
 * binary name, and the CLI verb that applies safe fixes in place. Biome's `check --write`
 * applies safe fixes and organizes imports; `--unsafe` is deliberately omitted so only
 * safe fixes land (§6.1).
 */
interface LinterSpec {
  pkg: string;
  bin: string;
  args: readonly string[];
}

/** The linters `lint-fix` supports, resolved from the folded tree's own manifest (§6.1). */
const SUPPORTED_LINTERS: readonly LinterSpec[] = [
  { pkg: '@biomejs/biome', bin: 'biome', args: ['check', '--write'] },
];
```

- [ ] **Step 3: Rewrite `resolveLinter` to select from the table**

Replace the body of `resolveLinter` (keep its doc comment, updating the parenthetical to "v0 catalog" wording) with:

```ts
function resolveLinter(cwd: string, toolchainRoot: string): Linter {
  const declared = SUPPORTED_LINTERS.filter((linter) => manifestDeclares(cwd, linter.pkg));
  if (declared.length === 0) {
    throw new OpApplicationError(
      'lint-fix',
      `no supported linter is declared in the tree's package.json (supported: ${SUPPORTED_LINTERS.map((l) => l.pkg).join(', ')})`,
    );
  }
  const [spec] = declared;
  const bin = resolveBin(spec.bin, [toolchainRoot, cwd]);
  if (!bin) {
    throw new OpApplicationError(
      'lint-fix',
      `${spec.pkg} is declared but its ${spec.bin} binary was not found in node_modules/.bin (run the package install)`,
    );
  }
  return { bin, args: spec.args };
}
```

(With one table entry, `declared` is length 0 or 1 — identical outcomes to the old code: none-declared throws, Biome resolves, missing-bin throws.)

- [ ] **Step 4: Run the full suite — must be green with zero test changes**

Run: `pnpm test`
Expected: PASS (same 4 `lint-fix` tests, unchanged). If any fail, the refactor changed behaviour — revert and fix.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit** (via `git-commit` skill; shift dates outside work hours)

Message intent: `refactor: table-ize lint-fix linter resolution` with a body noting it introduces `SUPPORTED_LINTERS` as a behaviour-preserving seam for the coming ESLint support, and includes the design + plan docs.

- [ ] **Step 7: Open PR 1** (via `git-branch` + `git-pull-request` skills)

Branch `jsalvata/prep-eslint-lint-fix` off `main`. PR body: states this is prep (PR 1 of 2), pure behaviour-preserving refactor, feature stacks on top.

---

## PR 2 — Feature: add ESLint

Stacked on `jsalvata/prep-eslint-lint-fix`.

### Task 2: ESLint row + both-declared ambiguity, TDD via a stub `eslint`

**Files:**
- Modify: `src/test-helpers.ts` (add `FIXTURE_ESLINT_PACKAGE_JSON`, `installStubEslint`)
- Modify: `src/engine/ops/lint-fix.test.ts` (3 new tests)
- Modify: `src/engine/ops/lint-fix.ts` (`SUPPORTED_LINTERS` row, ambiguity throw)

**Interfaces:**
- Consumes: `scaffoldProject`, `loadProject`, `applyLintFix`, `OpApplicationError`, `REPO_ROOT`.
- Produces: `FIXTURE_ESLINT_PACKAGE_JSON: string`; `installStubEslint(cwd: string): Promise<void>` (writes `<cwd>/node_modules/.bin/eslint`).

- [ ] **Step 1: Add the ESLint fixture helpers to `src/test-helpers.ts`**

Add `chmod` and `mkdir` to the existing `node:fs/promises` import if not present, then add:

```ts
/** A committable `package.json` declaring ESLint so the `lint-fix` op selects it. */
export const FIXTURE_ESLINT_PACKAGE_JSON = `${JSON.stringify(
  { name: 'fixture', devDependencies: { eslint: '^9.0.0' } },
  null,
  2,
)}\n`;

/**
 * Write a stub `eslint` into `<cwd>/node_modules/.bin/eslint` that honors `--fix <files>`
 * by replacing `var` with `const` in each named file. `resolveBin` searches the fixture
 * cwd, so tests resolve this without an eslint devDep on waiver-stamp — which would make
 * this repo's own manifest declare two linters and trip the both-declared ambiguity rule.
 * ESLint's real autofix determinism is an assumed third-party property (spec §9); the stub
 * validates the engine's seam (detection → `--fix` invocation → changed-file detection).
 */
export async function installStubEslint(cwd: string): Promise<void> {
  const binDir = join(cwd, 'node_modules', '.bin');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'eslint');
  const script = [
    '#!/usr/bin/env node',
    "const { readFileSync, writeFileSync } = require('node:fs');",
    "const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));",
    'for (const f of files) {',
    "  const before = readFileSync(f, 'utf8');",
    "  const after = before.replace(/\\bvar\\b/g, 'const');",
    '  if (after !== before) writeFileSync(f, after);',
    '}',
    '',
  ].join('\n');
  await writeFile(bin, script, 'utf8');
  await chmod(bin, 0o755);
}
```

- [ ] **Step 2: Write the three failing tests in `src/engine/ops/lint-fix.test.ts`**

Update the import line to add the new helpers, then append these tests inside the `describe('applyLintFix', …)` block:

```ts
it('runs ESLint --fix over the named files and reports the change', async () => {
  fix = await scaffoldProject({
    'package.json': FIXTURE_ESLINT_PACKAGE_JSON,
    'src/use.ts': 'var x = 1;\nexport const s = x;\n',
  });
  await installStubEslint(fix.cwd);
  const project = loadProject(fix.cwd);

  const changed = applyLintFix(
    project,
    fix.cwd,
    { op: 'lint-fix', files: ['src/use.ts'] },
    fix.cwd, // stub eslint lives in the fixture's own node_modules/.bin
  );

  expect(changed).toEqual(['src/use.ts']);
  expect(project.getSourceFileOrThrow(`${fix.cwd}/src/use.ts`).getFullText()).toContain(
    'const x = 1;',
  );
});

it('reports no change when ESLint finds nothing to fix', async () => {
  fix = await scaffoldProject({
    'package.json': FIXTURE_ESLINT_PACKAGE_JSON,
    'src/use.ts': 'export const s = 1;\n',
  });
  await installStubEslint(fix.cwd);
  const project = loadProject(fix.cwd);

  const changed = applyLintFix(
    project,
    fix.cwd,
    { op: 'lint-fix', files: ['src/use.ts'] },
    fix.cwd,
  );

  expect(changed).toEqual([]);
});

it('FAILs closed when the tree declares both Biome and ESLint (ambiguous toolchain)', async () => {
  fix = await scaffoldProject({
    'package.json': `${JSON.stringify(
      { name: 'fixture', devDependencies: { '@biomejs/biome': '^1.9.4', eslint: '^9.0.0' } },
      null,
      2,
    )}\n`,
    'src/use.ts': 'export const s = 1;\n',
  });
  const project = loadProject(fix.cwd);
  const cwd = fix.cwd;

  // Assert on `.detail`, not just the error class: OpApplicationError's message is a
  // static string, and a missing-bin failure is also an OpApplicationError. Matching the
  // detail proves the throw is the ambiguity check, giving a precise RED before Step 5.
  let caught: unknown;
  try {
    applyLintFix(project, cwd, { op: 'lint-fix', files: ['src/use.ts'] }, cwd);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(OpApplicationError);
  expect((caught as OpApplicationError).detail).toContain('ambiguous');
});
```

Import line becomes:

```ts
import {
  FIXTURE_BIOME_JSON,
  FIXTURE_ESLINT_PACKAGE_JSON,
  FIXTURE_PACKAGE_JSON,
  type Fixture,
  installStubEslint,
  REPO_ROOT,
  scaffoldProject,
} from '../../test-helpers.ts';
```

- [ ] **Step 3: Run the new tests — verify they FAIL**

Run: `pnpm test src/engine/ops/lint-fix.test.ts`
Expected: the two ESLint tests FAIL (no `eslint` in `SUPPORTED_LINTERS` → they throw "no supported linter is declared" instead of returning). The ambiguity test FAILs on the `.detail` assertion: with only Biome in the table, `declared` is `[biome]`, whose bin isn't installed in the fixture, so the throw's detail is "binary was not found", not "ambiguous".

- [ ] **Step 4: Add the ESLint row to `SUPPORTED_LINTERS`**

In `src/engine/ops/lint-fix.ts`:

```ts
const SUPPORTED_LINTERS: readonly LinterSpec[] = [
  { pkg: '@biomejs/biome', bin: 'biome', args: ['check', '--write'] },
  { pkg: 'eslint', bin: 'eslint', args: ['--fix'] },
];
```

- [ ] **Step 5: Add the both-declared ambiguity throw to `resolveLinter`**

Insert, immediately after the `declared.length === 0` block and before `const [spec] = declared;`:

```ts
  if (declared.length > 1) {
    throw new OpApplicationError(
      'lint-fix',
      `the tree declares multiple supported linters (${declared
        .map((l) => l.pkg)
        .join(', ')}); the committed toolchain is ambiguous`,
    );
  }
```

- [ ] **Step 6: Run the whole suite — all green**

Run: `pnpm test`
Expected: PASS (the 4 original + 3 new `lint-fix` tests, and everything else).

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit** (via `git-commit` skill; shift dates outside work hours)

Message intent: `feat: support ESLint in lint-fix` with a body noting the ESLint row, the both-declared fail-closed rule, and the stub-based tests.

### Task 3: Documentation

**Files:**
- Modify: `docs/spec.md` (§6.1 `lint-fix` bullet; §18 "Later" list)
- Modify: `README.md` (if it enumerates `lint-fix`'s supported linters)

- [ ] **Step 1: Update spec §6.1**

In the `lint-fix` bullet (around lines 313-334), change "e.g. `biome check --write`" phrasing so ESLint is included, and add a sentence naming the fail-closed both-declared rule. Suggested insertion after the "delegated to an external binary" sentence:

> The linter is resolved from the checked-out manifest — v0 supports Biome (`biome check --write`) and ESLint (`eslint --fix`), safe fixes only. A tree that declares **both** is ambiguous and FAILs closed (§9): the op assumes a single committed linter, and there is no per-op selector to disambiguate.

- [ ] **Step 2: Remove the shipped item from spec §18 "Later"**

Delete the bullet at lines ~663-665 ("ESLint support for `lint-fix` (v0 ships Biome only …)").

- [ ] **Step 3: Update README if it lists linters**

Run: `grep -n -i "biome\|eslint\|lint-fix" README.md`
If a passage enumerates the supported linter(s) for `lint-fix`, update "Biome" → "Biome or ESLint". If README does not enumerate linters, note that and make no change.

- [ ] **Step 4: Sanity-check docs build/links**

Run: `pnpm test` (docs changes shouldn't break anything; confirms nothing references removed content)
Expected: PASS.

- [ ] **Step 5: Commit** (via `git-commit` skill; shift dates outside work hours)

Message intent: `docs: note ESLint support and both-declared rule for lint-fix`.

- [ ] **Step 6: Open PR 2** (via `git-pull-request` skill)

Branch `jsalvata/eslint-lint-fix` stacked on `jsalvata/prep-eslint-lint-fix`. PR body: states it stacks on PR 1, summarizes the ESLint row + ambiguity rule + stub-test approach, and includes a test plan.

---

## PR 3 — Cleanup refactor

*Skipped.* The feature adds a table row and one guard branch; it leaves no dead code, duplication, or stale names. Docs are updated in PR 2. Re-evaluate only if a future linter addition reveals recurring friction.
