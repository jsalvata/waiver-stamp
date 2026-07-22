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

**Downside-bounded.** The only automated *approval* comes from a held proof — no stamp,
and the PR falls to today's normal human review, unchanged. The only automated *negative*
signal is a REQUEST_CHANGES on a commit whose embedded waiver *fails* to stamp — a
provably-false claim worth flagging, not a veto on an ordinary PR. It never weakens or
bypasses review; for any change it can't prove, worst case = status quo.

## How it works, in one glance

An LLM (guided by the bundled skill) writes a waiver, applies it, then commits normally
with the waiver **embedded in the commit message**:

````bash
# 1. apply the waiver's transform ops to the working tree
$ waiver apply rename.json
applied: 1 file(s) changed

# 2. commit normally, with the waiver embedded as a ```waiver fence in the body
$ git commit -m "$(cat <<'EOF'
refactor: rename calculateTotal to computeOrderTotal

```waiver
{ "schema": "waiver-stamp/v0",
  "ops": [ { "op": "rename",
             "target": { "file": "src/orders.ts", "symbol": "calculateTotal" },
             "to": "computeOrderTotal" } ] }
```
EOF
)"

# 3. confirm locally, right after committing
$ waiver verify
stamped    514bb5d0 refactor: rename calculateTotal to computeOrderTotal
````

On push, CI aggregates every commit in the PR into a single verdict:

```bash
$ waiver stamp --base main --head my-branch
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

Both ways *actually make the rename* — the same task, given to Claude Opus 4.8 with
real tools in an isolated project. **Without a waiver**, it edits the files itself
(editing tools + a shell). **With a waiver**, it writes the waiver and applies it via
the `waiver_apply` MCP tool. We measure the **output tokens** each spends (the
overhead-independent measure of the work, and the size of the artifact a reviewer
reads) and check correctness by compiler emit against a ground-truth scoped rename —
with decoys (a `calculateTotalTax` look-alike and a same-named `calculateTotal` in an
`invoices` module) so a scope-blind edit *fails*:

| References renamed | Without a waiver | With a waiver | Savings | Correct every run? |
|---|---|---|---|---|
| 3  | 2611 ± 652  | 1358 ± 267 | **1.9×** | without: **no** · with: yes |
| 12 | 3981 ± 472  | 1395 ± 322 | **2.9×** | both: yes |
| 30 | 2954 ± 1021 | 1421 ± 403 | **2.1×** | both: yes |

(Output tokens, mean ± sample stddev over 5 runs.) Two things stand out. The waiver is
**flat and cheap** — ~1,400 tokens whatever the fan-out, because the deterministic
runner does the expansion — and it was **correct in all 15 runs**. Editing by hand
costs **~2–3× more**, varies far more run-to-run, and at 3 references was **not always
correct** (a run corrupted a decoy or missed a reference). So the waiver wins on both
axes that matter — fewer tokens to author *and* to review, and a result that's
mechanically vouched rather than hopefully-right. This is a dated snapshot of
non-deterministic model output — [`bench/results.md`](bench/results.md), reproduce with
`pnpm bench`.

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
server (so an agent can call `waiver_apply` / `waiver_verify` / `waiver_stamp`) and the
**`refactor-with-waiver`** skill that drives the authoring loop above:

```text
/plugin marketplace add jsalvata/waiver-stamp
/plugin install waiver-stamp@waiver-stamp
```

The plugin's MCP server runs `npx -y waiver-stamp mcp`, so the npm package above is
its only prerequisite.

### Automate PR review (CI/CD)

To turn a correctly waivered PR into an auto-approved one, wire `waiver stamp --json` into
your CI and add a privileged reviewer workflow that posts the mapped GitHub review. See
[`docs/auto-approval-setup.md`](docs/auto-approval-setup.md) for full instructions.

`waiver setup-repository`, run from inside a checked-out repo, wires it up end to end: it
provisions the App and its `WAIVER_STAMP_APP_ID` / `WAIVER_STAMP_APP_PRIVATE_KEY` secrets (for
the App-token path), writes the two caller workflows into `.github/workflows/`, seeds a
closed-by-default `.waiver-stamp.json` if none exists, adds a dedicated `waiver-stamp`
required-check ruleset, and opens a browser hand-off page listing the few steps left to you. The
**Create GitHub App** and **Install** clicks stay manual — it opens the browser at each. Pass
`--no-app` to do the file-and-ruleset half only, leaving the reviewer's auth for you to wire
(§2.6). It also warns, never edits, if the repo's commitlint would reject long waiver bodies or
if no single linter is declared for the `lint-fix` op.

The App is registered on whichever account owns the repository — an org for an org-owned repo,
otherwise your own — because a private App can only be installed where it's owned. So a repo
owned by *another* user needs that user to register the App. Registering one on an org
additionally needs `admin:org` on your token (`gh auth refresh -h github.com -s admin:org`) —
not to create the App, which happens in the browser under your GitHub session, but to write the
org secrets.

Setting up a *second* repository reuses that App rather than minting another:

- **Org-owned repos** share one App through org secrets, so every later repo needs only the
  Install click — no key, no browser handshake.
- **Personal repos** have no shared secret store, so setup asks once which you want. Save the
  key and it goes to `~/.waiver-install/<owner>.json` at mode 600, giving you one
  `waiver-stamp-<owner>` App that later repos reuse with no browser step. Decline (the default)
  and you get a `waiver-stamp-<owner>-<repo>` App dedicated to this repository, with nothing
  stored on disk — the next repository then gets its own. GitHub never lets a private key be
  downloaded twice, so a declined App can only ever serve the repo it was made for.

The required-check ruleset can't be added until the producer has run once — a check that never
reported would block every PR — so setup writes the caller workflows first and, if the
`waiver-stamp` check hasn't run yet, tells you to merge them and re-run; the second run adds the
ruleset. Re-running is always safe: every step checks current state and converges, so a run you
abandoned partway is recoverable. Re-running on a repo that already has both secrets provisions
no new App; to swap one in, delete the two secrets and re-run.

## CLI

```bash
waiver apply <waiver>                             # apply a waiver's transform ops to the working tree (`-` for stdin)
waiver verify [<commit>] [--json]                 # verify one commit's embedded waiver (default HEAD)
waiver stamp  --base <ref> --head <ref> [--json]  # aggregate the PR verdict over base..head
waiver mcp                                        # run the stdio MCP server
```

There is no separate `check` or `commit` command — the tool is a **verifier**, not a
commit wrapper. `apply` takes a waiver **file**; `verify`/`stamp` read the waiver
already **embedded** in the commit(s) they inspect (see [Authoring flow](#authoring-flow)
below).

Exit codes: `0` applied / stamped-or-skipped / verdict ∈ {APPROVE, COMMENT, ABSTAIN} ·
`1` stamping failure / invalid-or-unwaivered / REQUEST_CHANGES · `2` malformed waiver or
invocation · `3` internal error.

## Authoring flow

1. **`waiver apply <waiver>`** — expand the transform ops into the working tree
   (production code; hand-edit only test/doc files, tagged with `change-test` /
   `change-docs`).
2. **Commit normally** — full subject/body/footer, through the repo's usual commit
   path — with the waiver embedded as a fenced ` ```waiver ` block in the message body,
   placed **before any trailer paragraph** (`Refs:`, `BREAKING CHANGE:`) so tools like
   `semantic-release` still see the footer as the terminal paragraph.
3. **`waiver verify`** (no argument → `HEAD`) — confirms the commit you just wrote
   stamps, before you push. If it fails, fix the waiver, `apply` again, and amend the
   commit.

On push, CI runs **`waiver stamp --base <ref> --head <ref>`**, which walks every commit
in the range and emits the aggregate PR verdict: **APPROVE** (every commit stamped),
**COMMENT** (a mix of stamped and unwaivered commits), **REQUEST_CHANGES** (any commit's
waiver is present but invalid), or **ABSTAIN** (no commit carries a waiver).

**Use merge-commit or rebase-merge, not squash-merge.** A squash-merge discards the
individually-verified commits: the new squashed commit carries no waiver, so it is
unwaivered and falls back to normal human review (safe, but the stamp is lost). To keep
stamps through to the default branch, configure the repo to merge with a merge commit or
a rebase-merge, so the verified commits land as-is (spec §17.5).

**Adopting this in a repo whose commitlint enforces `body-max-line-length`:** pretty-
printed waiver JSON can have lines longer than the default 100-char limit. Disable the
rule (this repo does, in `commitlint.config.js`) so the `commit-msg` hook doesn't reject
waivered commits — `waiver setup-repository` detects and warns about this, but leaves your
commitlint config for you to edit.

## Scope (v0)

Implemented: the **`rename`** and **`move-file`** reproductive ops; the **`lint-fix`**
tool-reproducible op (runs the repo's own committed linter — v0: Biome or ESLint — over
the named files, safe fixes only); **`change-test`** / **`change-docs`** exclusion ops; the standing
**dependency-bump policy** (allowlisted,
up-moving dependency bumps confined to `package.json` + `pnpm-lock.yaml`; lockfile
honesty is delegated to the repo's required external check, e.g. lockfile-firewall —
pnpm repos only, `allowBumping` in a committed `.waiver-stamp.json`, off by
default); and the empty/minimal waiver (formatting-, comment-, and type-only changes are
invisible to the emit comparison, so they need no op). Guards: dynamic-reference,
published-API, emit-divergence (fail-closed). Single Nx project, app-internal.

Known shortcoming: the emit-divergence guard deliberately does **not** flag constructor
parameter properties — mainstream transpilers all compile them the way tsc does, and
flagging them rejected any file with error-class-style constructors. The sound fix,
planned as a future improvement, is running the emit comparison under the repository's
own CI/CD transpiler instead of tsc, which dissolves the whole tsc-vs-deploy
enumeration. See [`docs/spec.md` §8](docs/spec.md) for the reasoning.

Planned next (the vocabulary already lists them; authoring them errors today):
`extract-function`, `move-to-new-file`, npm/yarn support for the dependency-bump policy,
and multi-project reproductive coverage. See [`docs/spec.md` §13/§21](docs/spec.md) for
the roadmap.

## Waiver format

```jsonc
{
  "schema": "waiver-stamp/v0",
  "ops": [
    { "op": "rename", "target": { "file": "src/foo.ts", "symbol": "oldName" }, "to": "newName" },
    { "op": "move-file", "from": "src/foo.ts", "to": "src/util/foo.ts" },
    { "op": "lint-fix", "files": ["src/bar.ts"] },
    { "op": "change-docs", "files": ["README.md"] }
  ]
}
```

The op vocabulary lives in **one source**: the Zod schemas in
[`src/schema.ts`](src/schema.ts). The TypeScript types (`z.infer`) and the published
JSON Schema ([`schema/waiver-stamp.v0.schema.json`](schema/waiver-stamp.v0.schema.json),
generated by `pnpm gen:schema`, drift-guarded by a test) both derive from it. Full
reference: [`docs/spec.md` §5](docs/spec.md).

## Configuration — `.waiver-stamp.json`

Optional per-repo policy at the repo root. Every policy is **read from base** (the
commit's parent), so a PR can't widen its own
permissions in the same commit — and since `.waiver-stamp.json` can never itself be
waived (it's not a doc or a test), any edit to it is a byte-compared, review-forcing
diff. Absent file or absent key ⇒ that policy is **off**; nothing is auto-enabled.

```json
{
  "allowBumping": ["@myorg/*", "lodash"],
  "changeDocs": {
    "allow": ["docs/**", "**/README.md", "CHANGELOG.md"],
    "deny": [".claude/**", "**/CLAUDE.md", "**/AGENTS.md", ".cursor/**"]
  }
}
```

### Dependency bumps — `allowBumping`

A standing policy covers a `package.json` + lockfile change during the compare when it is
a plain-semver **up-move** of an allowlisted dependency (entries ending in `/*` are scope
prefixes; others are exact names) — or a dependency **removal**, which is covered for any
package, no allowlist entry needed. The lockfile bytes should be vouched separately by
the repo's external lockfile-honesty check (a CI gate which should always be on); the
stamp does not re-resolve them itself. Adding a dependency, or any other manifest edit,
still falls to review. Empty or absent ⇒ every version bump falls to review. See
[`docs/spec.md` §6.3](docs/spec.md).

### Confining docs — `changeDocs`

`change-docs` drops the named files from the behaviour comparison, so it is deliberately
locked down. A file is confinable only if it clears **both** gates:

1. an **inert-text extension floor** — `*.md`, `*.markdown`, `*.txt` (never `*.mdx`, which
   compiles to executable JS/JSX, nor any source file); and
2. the **allow/deny policy** — matched by `allow` and not vetoed by `deny` (both
   gitignore-style globs, `deny` winning).

Both lists are **empty by default** — with no config, or an empty `allow`, `change-docs`
confines **nothing**, keeping AI-instruction assets (`.claude/**`, `CLAUDE.md`,
agent/skill files) out of `change-docs` unless a repo explicitly opts them in. See
[`docs/spec.md` §6.5](docs/spec.md).

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
