# waiver-stamp

> Auto-approve the pull requests whose safety can be proven mechanically — and only those.

## The problem

Most refactor PRs are **mechanical**: rename a symbol and patch its 40 call sites,
extract a helper and rewire its references. The interesting decision is one line; the
rest is expansion a compiler could do.

That expansion is expensive twice over:

- **An LLM burns tokens and makes subtle mistakes** re-deriving edits a language
  service computes deterministically — and a missed call site or a stray edit hides
  easily in a 2,000-line "just a rename" diff.
- **A human reviewer rubber-stamps it.** Nobody reads 40 identical renames closely,
  so the one edit that *isn't* a rename — slipped into the same diff — sails through.

waiver-stamp removes both costs without lowering the bar. The author (human or LLM)
writes a **waiver** — a tiny JSON recipe of the *intent* ("rename `calculateTotal` →
`computeOrderTotal`"). The deterministic runner performs the **expansion**, and the
same runner later **re-derives and checks** that the PR's diff is exactly that
expansion and nothing more. The mechanical part is never hand-written, so it can't be
subtly wrong, and never hand-reviewed, because it's mechanically vouched.

**Downside-bounded.** waiver-stamp only ever *removes* review when it holds a proof.
No stamp → the PR gets today's normal human review. It never blocks, weakens, or
auto-rejects anything. Worst case = status quo.

## How it works, in one glance

An LLM (guided by the bundled skill) writes a waiver and lands it as a commit that
**carries its own waiver** in the message:

```bash
# 1. author + apply + commit, with the waiver embedded in the message
$ waiver commit rename.json -m "refactor: rename calculateTotal to computeOrderTotal"
committed 514bb5d0
```

```
refactor: rename calculateTotal to computeOrderTotal

```json
{ "schema": "waiver-stamp/v0", "tool": "waiver-stamp@0.1.0",
  "ops": [ { "op": "rename",
             "target": { "file": "src/orders.ts", "symbol": "calculateTotal" },
             "to": "computeOrderTotal" } ] }
```
```

CI then verifies every commit in the PR and emits a single verdict:

```bash
$ waiver verify --base main --head my-branch
verdict: APPROVE
  514bb5d0 stamped    refactor: rename calculateTotal to computeOrderTotal
```

- **APPROVE** — every commit carries a valid waiver → safe to auto-approve.
- **COMMENT** — only some commits are waivered → the rest still get human review.
- **REQUEST_CHANGES** — a commit has a waiver but it's *invalid* (a failed claim — a
  mistake, or a behaviour change smuggled behind a waiver).
- **ABSTAIN** — no waivers → say nothing, normal review applies.

The check is by **compiler emit**, not by trusting the diff: waiver-stamp folds the
waiver's ops over the base commit and requires the result's emitted JavaScript to
equal the PR's, file by file (modulo whitespace and comments). A smuggled logic
change makes the emit differ → the commit is `invalid` → REQUEST_CHANGES.

## Why it's worth it — measured, not asserted

How many **output tokens** Claude Opus 4.8 spends to *express* the same rename, two
ways, on identical code context (median of 3 runs; output tokens are
environment-overhead-independent and also the size of the artifact a reviewer reads):

| References renamed | Without a waiver (full diff) | With a waiver | Savings |
|---|---|---|---|
| 3  | 762  | 174 | **4.4×** |
| 12 | 515  | 167 | **3.1×** |
| 30 | 1,044 | 171 | **6.1×** |

The waiver stays a near-constant ~170 tokens however many references the rename
touches — the deterministic runner does the expansion — while the hand-written diff
runs several times larger. So both the **authoring** cost (tokens to write the change)
and the **review** cost (tokens to read the artifact that vouches for it) shrink the
same way, and the waiver path is verified end-to-end every run (its output applies and
stamps). This is a dated snapshot of non-deterministic model output —
[`bench/results.md`](bench/results.md), reproduce with `pnpm bench`.

## Trust posture — this is not a proof

waiver-stamp does not prove a refactor is correct (behaviour equivalence is
undecidable). It proves something narrower and checkable: **by reproduction**, that
the PR's diff is exactly what the language-service refactor would produce, so no
hand-edit is hidden in it. It is **fail-closed** (any doubt — a dynamic reference, a
published-API symbol, a transpiler-divergent construct — sends the PR to human review)
and **downside-bounded** (worst case = today's review). Treat a stamp as "very likely
safe and cheaply re-verifiable," not a formal guarantee. Full model:
[`docs/spec.md` §1.1](docs/spec.md) (trust posture), [§3](docs/spec.md) (the stamping
principle).

## Install

```bash
pnpm add -g waiver-stamp   # provides the `waiver` binary
```

Or use it as a **Claude Code plugin** ([`plugin/`](plugin/)) — it registers the MCP
server (so an agent can call `waiver_check` / `waiver_apply` / `waiver_stamp` /
`waiver_verify`) and the **`refactor-with-waiver`** skill that drives the authoring
loop above:

```text
/plugin marketplace add jsalvata/waiver-stamp
/plugin install waiver-stamp@waiver-stamp
```

The plugin's MCP server runs `npx -y waiver-stamp mcp`, so the npm package above is
its only prerequisite.

## CLI

```bash
waiver commit <waiver> [-m <subject>]                  # apply + commit with the waiver embedded
waiver verify --base <ref> --head <ref> [--json]       # per-commit PR verdict
waiver apply  <waiver>                                  # apply transform ops to the tree
waiver stamp  <waiver> --base <ref> --head <ref> [--json]  # stamp one waiver file
waiver check  <waiver> [--json]                         # schema + static-guard lint
waiver mcp                                              # run the stdio MCP server
```

Exit codes: `0` stamped / approve · `1` stamping failure / REQUEST_CHANGES · `2`
malformed waiver or tool-version mismatch · `3` internal error.

## Scope (v0)

Implemented: the **`rename`** reproductive op; **`change-test`** / **`change-docs`**
exclusion ops; and the empty/minimal waiver (formatting-, comment-, and type-only
changes are invisible to the emit comparison, so they need no op). Guards:
dynamic-reference, published-API, emit-divergence (fail-closed). Single Nx project,
app-internal.

Planned next (the vocabulary already lists them; authoring them errors today):
`extract-function`, `move-to-new-file`, `bump`, and multi-project reproductive
coverage. See [`docs/spec.md` §13/§21](docs/spec.md) for the roadmap.

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
[`src/schema.ts`](src/schema.ts). The TypeScript types (`z.infer`) and the published
JSON Schema ([`schema/waiver-stamp.v0.schema.json`](schema/waiver-stamp.v0.schema.json),
generated by `pnpm gen:schema`, drift-guarded by a test) both derive from it. Full
reference: [`docs/spec.md` §5](docs/spec.md).

## Development

```bash
pnpm install
pnpm gen:schema   # regenerate schema/*.json from src/schema.ts (Zod)
pnpm build        # gen:schema + tsc → dist/
pnpm test         # vitest (colocated, src/*.test.ts)
pnpm typecheck
pnpm lint         # biome
pnpm bench        # token-economy benchmark (drives the claude CLI; writes bench/)
```

- **Stack:** TypeScript (ESM, NodeNext), built on [`ts-morph`](https://ts-morph.com);
  MCP via `@modelcontextprotocol/sdk`. `zod@3.25` (v4 bridge).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/), enforced
  by commitlint via a husky `commit-msg` hook.
- **CI/CD:** GitHub Actions — `ci.yml` (lint, typecheck, build, test) and `release.yml`
  (semantic-release: version, npm publish, GitHub release on merge to `main`; needs an
  `NPM_TOKEN` secret).

## License

[MIT](LICENSE)
