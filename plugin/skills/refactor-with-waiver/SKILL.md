---
name: refactor-with-waiver
description: Use together with other planning skills when planning or writing any change that includes a refactor (renaming a symbol across the codebase, moving or renaming a whole file, reformatting or applying safe lint fixes, adding or removing comments), OR a docs change (editing a README, comments, or any non-shipping doc file), OR a tests-only change (adding or editing tests without touching source). Invoke it early, during planning, to split a mixed change into a waiverable mechanical commit and a separate behavioural one. Trigger on "refactor / reorganize / restructure code", "rename X everywhere", "move a file to another folder", "reformat / run the linter", "pure/mechanical refactor", "behaviour-preserving change", "edit doc", "update the README", "fix a typo", "edit a comment", "tests-only change", "add tests for X", "make this PR stampable", "rubberstamp PR", "write/generate a waiver", "waivered commit".
---

# Refactoring with a waiver

A **waiver** is a JSON recipe that lets `waiver-stamp` prove a commit is safe to
auto-approve without a human review. Your job: translate a refactor into the
closed op vocabulary, then commit it with the waiver embedded so CI can stamp it.
A waiver only ever *removes* review when a proof holds — when in doubt, **leave
the change out** and let it fall to human review (fail-closed, downside-bounded).

## Plan the split first

Before authoring anything, separate the change into its **behaviour-preserving**
part (waiverable) and its **behavioural** part (not). Only the mechanical part can
be stamped. If a task mixes the two — e.g. a rename *plus* a logic tweak — prefer
landing them as **separate PRs**: the mechanical PR carries waivers and auto-approves,
the behavioural PR gets normal review. When separate PRs aren't practical, fall back
to **separate commits** within one PR — each mechanical commit still stamps on its
own. Either way, a mechanical change entangled with a logic change in a single commit
stamps as *invalid*, so doing this at planning time is what makes the stamp available
at all.

## Ask before waiving key docs and AI assets

A `change-docs` exclusion is safe for genuinely inert files, but some non-code
files carry real weight and a silent auto-waive is the wrong default for them.
Before folding either category below into a waivered commit, **ask the user**
whether they want to waive review — and if they decline, leave the file out of
the waiver so the commit falls to normal human review:

- **Non-trivial changes to key documents** — READMEs, specs, and similar
  load-bearing docs. A typo fix or a reworded sentence is trivial; a rewrite, a
  changed contract, or new/removed guidance is not.
- **Any change to an AI asset** — skills (`SKILL.md`), agents, commands, or their
  prompts/front-matter — regardless of size, since these steer future automated
  behaviour.

When in doubt about whether a doc is "key" or a change is "trivial", ask. This is
the same fail-closed instinct as the rest of the skill: waiving is a convenience,
not an obligation.

## The guaranteed-stamp authoring loop

The intended loop (spec §3.3, §17.4) makes a stamp predictable:

1. Express the **production-code** change as transform ops — in v0, `rename`,
   `move-file`, and `lint-fix`.
   Prefer `waiver_apply` (MCP) or `waiver apply <waiver>` (CLI) to expand it into
   the working tree — don't hand-edit production code.
2. Hand-edit only the **test/doc** files; name them with `change-test` /
   `change-docs` exclusion ops in the waiver.
3. **Write a normal commit** — full subject/body/footer, through the repo's usual
   commit path — with the waiver embedded as a fenced ` ```waiver ` block in the
   body, placed **before any trailer paragraph** (`Refs:`, `BREAKING CHANGE:`) so
   `semantic-release` and other trailer consumers still read the footer as the
   terminal paragraph.
4. **`waiver verify`** (or the `waiver_verify` MCP tool) — folds the just-written
   commit (default `HEAD`) through the stamping principle and confirms it stamps,
   one command after committing. If it fails, fix the waiver, re-`apply`, and
   amend the commit (re-embedding the block).

CI then runs `waiver stamp --base <ref> --head <ref>` on push: it walks each
commit in the range, stamps each commit's embedded waiver, and prints an
aggregate verdict — **APPROVE** (all commits stamped) / **COMMENT** (a mix of
stamped and unwaivered) / **REQUEST_CHANGES** (any waiver invalid) / **ABSTAIN**
(no waivers). It exits 1 on REQUEST_CHANGES.

## Worked example: rename a widely-referenced function

Refactor: rename the top-level helper `computeTotal` to `computeOrderTotal`
across the project. The waiver:

```json
{
  "schema": "waiver-stamp/v0",
  "ops": [
    { "op": "rename", "target": { "symbol": "computeTotal" }, "to": "computeOrderTotal" }
  ]
}
```

Apply it, then commit normally with the waiver embedded:

````bash
waiver apply waiver.json
git commit -m "$(cat <<'EOF'
refactor: rename computeTotal to computeOrderTotal

```waiver
{
  "schema": "waiver-stamp/v0",
  "ops": [
    { "op": "rename", "target": { "symbol": "computeTotal" }, "to": "computeOrderTotal" }
  ]
}
```
EOF
)"
waiver verify
````

`apply` performs the rename across every reference. `verify` (default `HEAD`)
confirms the just-written commit stamps. On the PR, CI approves with:

```bash
waiver stamp --base main --head my-branch --json
```

## Op vocabulary (v0)

The JSON Schema at `schema/waiver-stamp.v0.schema.json` is the source of truth.
Validate against it — never invent ops.

**Transform · reproductive** (behaviour-preserving; folded over base, in order):
- `{ "op": "rename", "target": { "symbol" }, "to": "newName" }`
- `{ "op": "move-file", "from": "path", "to": "path" }` — move/rename a whole
  file; static imports/exports and dynamic `import()` specifiers are rewritten
  for you. Refuses if a file already exists at `to`.

**Transform · tool-reproducible** (folded over base, in order):
- `{ "op": "lint-fix", "files": [...] }` — run the repo's own committed linter
  (v0: Biome) over exactly the named files, applying **safe fixes only**. List it
  **last**, after the ops whose output it cleans up (e.g. a `move-file` rewrites
  import specifiers, then `lint-fix` sorts them). You never predict or match the
  linter's output: `verify` reruns the same `lint-fix` in the fold, so whatever
  reordering or reformatting it produces is reproduced on both sides of the emit
  compare. So don't fear a resort you can't foresee — a `move-file` that leaves
  imports out of order still stamps the moment a `lint-fix` follows it. Do **not**,
  however, hand-apply the fixes yourself: a manual edit riding alongside `lint-fix`
  mismatches the folded result and breaks the stamp. Works on any file, standalone
  or alongside other ops. The repo must declare the linter in `package.json`.

**Exclusion · confinement** (removed from the comparison; order-free):
- `{ "op": "change-test", "files": [...] }` — verified non-shipping test files.
- `{ "op": "change-docs", "files": [...] }` — inert doc files (`*.md`/`*.markdown`/`*.txt`,
  never `*.mdx`) that the repo's `.waiver-stamp.json` `changeDocs` policy allows
  (`allow` ∧ ¬`deny`; empty/absent config confines nothing). See `docs/spec.md` §6.5.

**Standing config lands first, waivers rely on it later.** Every `.waiver-stamp.json`
policy — `changeDocs`, `allowBumping`, any future one — is read from a commit's **base**,
never the commit itself (spec §6.3), so a commit can never widen policy to waive its own
change. A `.waiver-stamp.json` edit is also byte-compared and unwaivable, so it always
falls to a human. Together that gives a clean workflow: **establish or widen the config in
its own reviewed commit or PR, then rely on it from waivers in later commits or PRs.** So
to `change-docs` a file the policy doesn't yet allow (or to `allowBumping` a new package),
land the `.waiver-stamp.json` change first — an earlier commit in the same PR, or an
already-merged one — and the waivered commit builds on the base that now carries it.

When you author or edit `.waiver-stamp.json`, conform it to
`schema/waiver-stamp-config.v0.schema.json` (the source of truth, generated from the Zod
config schema). To give a human's editor live validation, add its `$id` as a `"$schema"`
pointer at the top of the file — the loader recognises and ignores that key:
`"$schema": "https://raw.githubusercontent.com/jsalvata/waiver-stamp/main/schema/waiver-stamp-config.v0.schema.json"`.

> **Not yet implemented in this build:** `extract-function` and `move-to-new-file`.
> The schema still lists them, but `apply` / `stamp` will FAIL with "not yet
> implemented in v0" if a waiver uses them. They are planned next — do **not** author
> waivers using them yet. For v0, stick to `rename` / `move-file` / `lint-fix`, the
> `change-test` / `change-docs` exclusions, and empty/minimal waivers.

## Selector cookbook for `rename` (§5.2)

Symbols are TSDoc declaration references, never `line:col`. The resolvable forms
in v0:
- `topLevelName` — a top-level function, class, const, type, etc.
- `ClassName.member` — a method or property of a class.

The schema also admits `ClassName.(member:static)`, `(ClassName:constructor)`,
and overload-index grammar like `overloadedFn.(:2)`, but stick to the two common
forms above unless you have a reason not to.

## What needs no op (free under emit comparison, §7)

The compare is over compiler **emit**, so these stamp with an **empty or minimal**
waiver — do not add ops for them:
- formatting-only and comment-only changes (including `@ts-ignore` etc.);
- type-only edits: add/adjust annotations, add an interface, extract/rename a type,
  `as` / `satisfies` / `!`.

A commit whose only changes are invisible to emit needs no transform op at all —
an empty `ops` array stamps clean.

## Dependency bumps need no op (standing policy, §6.3)

Bumping a dependency is **not** a waiver op. If the repo has a `.waiver-stamp.json` with
an `allowBumping` list, an allowlisted, up-moving bump confined to `package.json` +
`pnpm-lock.yaml` is covered automatically — like formatting. **Removing** a dependency is
also covered (any package — removing pulls in nothing), and **adding** one never is. To
land a bump:

1. Bump it with your package manager: `pnpm add <pkg>@latest` (or `@5.1.0` to pin).
2. Commit `package.json` + `pnpm-lock.yaml` with an **empty** waiver embedded —
   `{ "schema": "waiver-stamp/v0", "ops": [] }` — which opts the commit into stamping.
3. `waiver verify` — the policy checks the manifest envelope (allowlisted, up-moving,
   confined).

`apply` does **not** expand a bump (there is no op). pnpm repos only. Anything outside
the envelope — an added dependency, a non-allowlisted bump, a downward move, a
`git:`/`npm:` specifier, any other manifest field — is not covered → the commit falls to
review. Keep a bump in **its own commit** when bundling with a `rename`/`move-file`.

## What is out of scope (let it fall to review)

- Any change to a **production** file not reproduced by a transform op (e.g. a
  string-literal *value* change) → it will mismatch → review.
- `rename` / `move-file` on **published surfaces** (`libs/*-sdk`,
  `*-api-contract` `index.ts`) or across Nx project boundaries → guard FAILs
  (v0 is single-project, app-internal).
- Symbols reached by dynamic references (`obj["name"]`, string-keyed DI, refs in
  JSON/SQL/templates) → dynamic-reference guard FAILs. Same for a moved file's
  path reached outside an import (`require('./x')`, `jest.mock('./x')`, config
  strings).

## MCP tools

When running inside the plugin, the engine is also exposed as MCP tools (spec
§18.1): `waiver_apply` (`{ waiver, cwd? }` — waiver JSON inline, not a file
path), `waiver_verify` (`{ commit?, cwd? }` — defaults to `HEAD`), and
`waiver_stamp` (`{ base, head, cwd? }`). Use `waiver_apply` for the production
edits and `waiver_verify` to confirm the commit stamps before push.

## Validate before finishing

After committing, always confirm the commit stamps and report the result:

```bash
waiver verify --json
```

See `docs/spec.md` for the full model, guards, and worked examples (§11).
