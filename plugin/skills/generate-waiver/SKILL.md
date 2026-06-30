---
name: generate-waiver
description: Use when authoring a waiver-stamp waiver for a code change — translating a refactor, internal dependency bump, or test/doc-only change into the v0 op vocabulary and validating it with `waiver check`. Trigger on "write a waiver", "make this PR stampable", "generate a waiver for this change".
---

# Generating a waiver

A **waiver** is a JSON recipe that lets `waiver-stamp` prove a PR is safe to
auto-approve without a human review. Your job: translate a change into the closed
op vocabulary, then validate it. A waiver only ever *removes* review when a proof
holds — when in doubt, **leave the change out** and let it fall to human review
(fail-closed, downside-bounded).

## The guaranteed-stamp workflow

The intended authoring loop (spec §3.3) makes a stamp predictable:

1. Express the **production-code** change as transform ops (`rename`,
   `extract-function`, `move-to-new-file`, `bump`).
2. Run `waiver apply <waiver>` on the base — it *generates* the production edits.
3. Hand-edit only the **test/doc** files; name them with `change-test` /
   `change-docs` exclusion ops.
4. Push head = (apply output) + (hand edits).

Stamping then re-folds the transform ops (matching head's production files by
construction) and excludes the predicate-checked test/doc files.

## Op vocabulary (v0)

The JSON Schema at `schema/waiver-stamp.v0.schema.json` is the source of truth.
Validate against it — never invent ops.

**Transform · reproductive** (behaviour-preserving; folded over base, in order):
- `{ "op": "rename", "target": { "file", "symbol" }, "to": "newName" }`
- `{ "op": "extract-function", "target": { "file", "within", "from", "to?" }, "name": "fn" }`
- `{ "op": "move-to-new-file", "symbols": [...], "from": "path", "to": "path" }`

**Transform · transitive** (changes behaviour; trusts upstream review):
- `{ "op": "bump", "packages": ["@myorg/foo"] }` — allowlisted internal packages only.

**Exclusion · confinement** (removed from the comparison; order-free):
- `{ "op": "change-test", "files": [...] }` — verified non-shipping test files.
- `{ "op": "change-docs", "files": [...] }` — verified non-shipping doc files.

## Selectors (§5.2)

- **Symbols** are TSDoc declaration references, never `line:col`:
  `topLevelName`, `ClassName.member`, `ClassName.(member:static)`,
  `(ClassName:constructor)`, `overloadedFn.(:2)`.
- **Nodes** (`extract-function` target) use `{ within, from, to? }` where `from`/`to`
  are **verbatim source snippets** (the resolver normalizes both sides); add `nth`
  to disambiguate. Omit `to` for a single node.

## What needs no op (free under emit comparison, §7)

The compare is over compiler **emit**, so these stamp with an **empty or minimal**
waiver — do not add ops for them:
- formatting-only and comment-only changes (including `@ts-ignore` etc.);
- type-only edits: add/adjust annotations, add an interface, extract/rename a type,
  `as`/`satisfies`/`!`.

## What is out of scope (let it fall to review)

- Any change to a **production** file not reproduced by a transform op (e.g. a
  string-literal *value* change) → it will mismatch → review.
- Reproductive ops on **published surfaces** (`libs/*-sdk`, `*-api-contract`
  `index.ts`) or across Nx project boundaries → guard FAILs (v0 is single-project,
  app-internal).
- Symbols reached by dynamic references (`obj["name"]`, string-keyed DI, refs in
  JSON/SQL/templates) → dynamic-reference guard FAILs.

## Header

```jsonc
{ "schema": "waiver-stamp/v0", "tool": "waiver-stamp@<x.y.z>", "ops": [ ... ] }
```

The header carries **only** `schema` + `tool`. TypeScript version, package manager,
and `tsconfig` come from the repo — never restate them.

## Validate before finishing

Always run the fast lint and report the result:

```bash
waiver check path/to/waiver.json
```

If a target repo and base/head refs are available, also dry-run the stamp:

```bash
waiver stamp path/to/waiver.json --base <ref> --head <ref> --json
```

(`apply` and `stamp` are stubbed in the v0 scaffold; `check` is fully functional.)

See `docs/spec.md` for the full model, guards, and worked examples (§11).
