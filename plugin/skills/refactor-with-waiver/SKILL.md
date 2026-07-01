---
name: refactor-with-waiver
description: Use when planning or writing a behaviour-preserving (pure/mechanical) refactor — renaming a symbol across the codebase, moving a declaration to its own file, extracting a helper, reformatting code, adding or removing comments, or a test-/doc-only change. If the closed op vocabulary can express the change, it can be auto-approved without human review, so reach for this any time a refactor is the goal. Invoke it early, during planning, to split a mixed change into a waiverable mechanical commit and a separate behavioural one. Trigger on "rename X everywhere", "extract this into a function", "move X to its own file", "pure/mechanical refactor", "behaviour-preserving change", "make this PR stampable", "write/generate a waiver", "land a waivered commit".
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

## The guaranteed-stamp authoring loop

The intended loop (spec §3.3, §17.4) makes a stamp predictable:

1. Express the **production-code** change as transform ops — in v0, `rename`.
   Prefer `waiver_apply` (MCP) or `waiver apply <waiver>` (CLI) to expand it into
   the working tree — don't hand-edit production code.
2. Hand-edit only the **test/doc** files; name them with `change-test` /
   `change-docs` exclusion ops in the waiver.
3. **Write a normal commit** — full subject/body/footer, through the repo's usual
   commit path — with the waiver embedded as a fenced ` ```waiver ` block in the
   body, placed **before any trailer paragraph** (`Refs:`, `BREAKING CHANGE:`) so
   `semantic-release` and other trailer consumers still read the footer as the
   terminal paragraph. There is no dedicated authoring command — the tool is a
   verifier, not a commit wrapper.
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

**Exclusion · confinement** (removed from the comparison; order-free):
- `{ "op": "change-test", "files": [...] }` — verified non-shipping test files.
- `{ "op": "change-docs", "files": [...] }` — verified non-shipping doc files.

> **Not yet implemented in this build:** `extract-function`, `move-to-new-file`,
> and `bump`. The schema still lists them, but `apply` / `stamp` will FAIL with
> "not yet implemented in v0" if a waiver uses them. They are planned next — do
> **not** author waivers using them yet. For v0, stick to `rename`, the
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

## What is out of scope (let it fall to review)

- Any change to a **production** file not reproduced by a transform op (e.g. a
  string-literal *value* change) → it will mismatch → review.
- `rename` on **published surfaces** (`libs/*-sdk`, `*-api-contract` `index.ts`)
  or across Nx project boundaries → guard FAILs (v0 is single-project,
  app-internal).
- Symbols reached by dynamic references (`obj["name"]`, string-keyed DI, refs in
  JSON/SQL/templates) → dynamic-reference guard FAILs.

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

If a target repo and base/head refs are available, also preview the PR verdict:

```bash
waiver stamp --base <ref> --head <ref> --json
```

See `docs/spec.md` for the full model, guards, and worked examples (§11).
