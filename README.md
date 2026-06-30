# waiver-stamp

> Auto-approve PRs whose safety can be proven mechanically.

A **waiver** is a JSON recipe describing a change; **stamping** is validating a
PR's diff against its waiver. `waiver-stamp` spares humans from reviewing PRs whose
safety can be checked **deterministically, without AI, fail-closed**.

It only ever *removes* review when it holds a proof. No stamp → the PR gets today's
normal human review. It never blocks, weakens, or auto-rejects anything. Worst case
= status quo. (Read the trust posture in [`docs/spec.md` §1.1](docs/spec.md) — a
stamp is "very likely safe and cheaply re-verifiable," not a formal proof.)

> **Status: v0 scaffold.** The repo, JSON Schema, types, CLI, and `check` are real.
> The `apply` and `stamp` engines are stubs (they validate the waiver, then report
> not-implemented). See the [spec](docs/spec.md) for the full v0 design.

## Install

```bash
pnpm add -g waiver-stamp   # provides the `waiver` binary
```

## CLI

```bash
waiver apply <waiver>                                   # apply transform ops (stub)
waiver stamp <waiver> --base <ref> --head <ref> [--json]  # validate a diff (stub)
waiver check <waiver> [--json]                          # schema + guard lint (works)
```

Exit codes: `0` stamped · `1` stamping/guard/coverage failure · `2` malformed
waiver / header mismatch · `3` internal error (incl. not-yet-implemented).

## Waiver format

```jsonc
{
  "schema": "waiver-stamp/v0",
  "tool":   "waiver-stamp@0.0.0",
  "ops": [
    { "op": "rename", "target": { "file": "src/foo.ts", "symbol": "oldName" }, "to": "newName" },
    { "op": "change-docs", "files": ["README.md"] }
  ]
}
```

The op vocabulary lives in **one source**: the Zod schemas in
[`src/schema.ts`](src/schema.ts). From it we derive the TypeScript types
(`z.infer`) and **generate** the published JSON Schema
[`schema/waiver-stamp.v0.schema.json`](schema/waiver-stamp.v0.schema.json) via
`pnpm gen:schema` (a drift-guard test keeps the committed file in sync). The
generated JSON Schema still serves its triple duty — LLM structured-output
constraint, author lint, and the stamper's closed-vocabulary gate. Full reference:
[`docs/spec.md` §5](docs/spec.md).

## Claude Code plugin

[`plugin/`](plugin/) ships a Claude Code plugin that helps author waivers:

- the **`generate-waiver`** skill — translate a change into the op vocabulary and
  validate it with `waiver check`;
- the **`/waiver`** command — a thin wrapper that runs the skill over a diff.

## Development

```bash
pnpm install
pnpm gen:schema   # regenerate schema/*.json from src/schema.ts (Zod)
pnpm build        # gen:schema + tsc → dist/
pnpm test         # vitest (tests are colocated, src/*.test.ts)
pnpm typecheck
pnpm lint         # biome
pnpm dev -- check examples/valid.waiver.json   # run the CLI from source
```

### Project setup

- **Stack:** TypeScript (ESM, NodeNext), built on [`ts-morph`](https://ts-morph.com).
  Op vocabulary, types, and JSON Schema all derive from one Zod source
  ([`src/schema.ts`](src/schema.ts); `zod@3.25` via the v4 bridge).
- **Package manager:** pnpm. **Tests:** vitest (colocated). **Lint/format:** Biome.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/),
  enforced by commitlint via a husky `commit-msg` hook.
- **CI/CD:** GitHub Actions — `ci.yml` (lint, typecheck, build, test, CLI smoke on
  every PR) and `release.yml` (semantic-release: version, npm publish, GitHub
  release, and CHANGELOG on merge to `main`; requires an `NPM_TOKEN` secret).

## License

[MIT](LICENSE)
