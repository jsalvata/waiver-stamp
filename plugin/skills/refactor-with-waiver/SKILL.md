---
name: refactor-with-waiver
description: Use when writing a refactor with a waiver, making a PR stampable, or landing a waivered refactor commit — translating a behaviour-preserving refactor or test/doc-only change into the v0 op vocabulary, committing it with the waiver embedded, and validating with `waiver check` / `waiver verify`. Trigger on "write a refactor with a waiver", "make this PR stampable", "land a waivered refactor commit", "generate a waiver".
---

# Refactoring with a waiver

A **waiver** is a JSON recipe that lets `waiver-stamp` prove a commit is safe to
auto-approve without a human review. Your job: translate a refactor into the
closed op vocabulary, then commit it with the waiver embedded so CI can stamp it.
A waiver only ever *removes* review when a proof holds — when in doubt, **leave
the change out** and let it fall to human review (fail-closed, downside-bounded).

## The guaranteed-stamp authoring loop

The intended loop (spec §3.3, §17.1) makes a stamp predictable:

1. Express the **production-code** change as transform ops — in v0, `rename`.
2. Write the draft waiver and validate its shape with `waiver check <waiver>`
   (or the `waiver_check` MCP tool).
3. **`waiver commit <waiver> -m "refactor: …"`** — this applies the waiver
   (generating the production edits), stages them, and writes a commit whose
   message embeds the waiver in a fenced ```json block (§17.4). This is the
   recommended path: the embed is well-formed by construction, so a later
   `waiver verify` won't surprise-fail on a hand-mangled block.
4. Hand-edit only the **test/doc** files; name them with `change-test` /
   `change-docs` exclusion ops before you commit.

`waiver apply <waiver>` is available if you want to expand the transform ops
into the working tree without committing — but prefer `waiver commit`, which
applies + commits + embeds in one step.

CI then runs `waiver verify --base <main> --head <branch>`: it walks each commit
in the range, stamps each commit's embedded waiver, and prints an aggregate
verdict — **APPROVE** (all commits valid) / **COMMENT** (some valid) /
**REQUEST_CHANGES** (any waiver invalid) / **ABSTAIN** (no waivers). It exits 1
on REQUEST_CHANGES.

## Worked example: rename a widely-referenced function

Refactor: rename the top-level helper `computeTotal` to `computeOrderTotal`
across the project. The waiver:

```json
{
  "schema": "waiver-stamp/v0",
  "tool": "waiver-stamp@0.0.0",
  "ops": [
    { "op": "rename", "target": { "symbol": "computeTotal" }, "to": "computeOrderTotal" }
  ]
}
```

Validate, then commit:

```bash
waiver check waiver.json
waiver commit waiver.json -m "refactor: rename computeTotal to computeOrderTotal"
```

`commit` applies the rename across every reference, stages the result, and
writes the commit with the waiver embedded. On the PR, CI approves with:

```bash
waiver verify --base main --head my-branch --json
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

## Header

```jsonc
{ "schema": "waiver-stamp/v0", "tool": "waiver-stamp@<x.y.z>", "ops": [ ... ] }
```

The header carries **only** `schema` + `tool`. TypeScript version, package manager,
and `tsconfig` come from the repo — never restate them.

## MCP tools

When running inside the plugin, the engine is also exposed as MCP tools (spec
§18.1): `waiver_check`, `waiver_apply`, `waiver_stamp`, `waiver_verify`. Each
takes the **waiver JSON inline** (an object, not a file path) plus an optional
`cwd` (and `base` / `head` for stamp / verify). Use `waiver_check` for the inner
authoring loop and `waiver_verify` to preview the PR verdict.

## Validate before finishing

Always run the fast lint and report the result:

```bash
waiver check path/to/waiver.json
```

If a target repo and base/head refs are available, also preview the verdict:

```bash
waiver verify --base <ref> --head <ref> --json
```

See `docs/spec.md` for the full model, guards, and worked examples (§11).
