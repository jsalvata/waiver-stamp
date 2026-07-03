# Split "compose the commit message" from "embed the waiver"

Status: proposal · Adds `waiver embed`; keeps `waiver commit` as a wrapper. Touches §17.4.

## Problem

`waiver commit <waiver> -m <subject>` is the only supported path to a waivered
commit, and it can only express a **subject**. Everything about the message is
hard-coded, so a waivered commit cannot carry:

- a commit **body** (the "why", which §17.1's own example shows),
- a Conventional-Commits **footer/trailer** (`Refs:`, `BREAKING CHANGE:`),

and it bypasses the repo's commitlint `commit-msg` hook entirely — the commit message
is assembled by string concatenation, never linted.

## Current behaviour

- `src/commit.ts:38-39` — `commitWaiver` takes only `options.subject`, defaulting to
  `'refactor: apply waiver'`, and calls `git commit -m embedWaiver(subject, waiver)`.
- `src/commit-waiver.ts:67-70` — `embedWaiver` hard-codes the shape
  `` `${subject}\n\n```json\n${json}\n```\n` `` — subject, blank line, fence, done.
  There is no seam for a body or a footer.
- `.husky/commit-msg` runs `commitlint --edit` and `commitlint.config.js` extends
  `config-conventional` — but `waiver commit` shells `git commit` directly, so the
  message it builds is whatever `embedWaiver` produced, and the hook only ever sees a
  subject + a json block.
- Extraction (`extractWaiverBlock`, `src/commit-waiver.ts:34-64`) scans **all**
  ```` ```json ```` fences and selects by `schema` equality, so *where* the block sits
  in the message does not affect extraction.

## The footer-placement question

Conventional Commits parse **trailers at the end** of the message (last paragraph,
`Key: value` lines). commitlint validates the subject and, depending on rules, the
footer. So the ```` ```json ```` block must not land *after* the trailer block, or it
becomes the last paragraph and commitlint may (a) mis-parse the fence as a malformed
trailer or (b) push the real trailers out of trailer position.

Extraction is *placement-agnostic* (it scans every fence — `src/commit-waiver.ts:36`),
so `verify` doesn't care. commitlint *does*. Therefore:

**Recommendation: body-before-footer.** The message becomes
`subject` · (blank) · `body` · (blank) · ```` ```json … ``` ```` · (blank) · `footer`.
The json block sits inside the body region, ahead of the trailer paragraph. This keeps
trailers as the terminal paragraph (commitlint-clean) and keeps extraction trivially
correct (any fence, anywhere). It also reads naturally: prose, then the machine recipe,
then refs.

## Proposed change

Decouple the two responsibilities:

- **`waiver apply`** (exists) generates the mechanical edits only.
- **New `waiver embed`** *amends `HEAD`*, inserting the ```` ```json ```` block into the
  existing message **body, before any footer/trailer block**, well-formed by
  construction. It re-parses `HEAD`'s message, splits off the trailing trailer
  paragraph, injects the block ahead of it, and `git commit --amend` with the result.

The recommended flow becomes:

```
waiver apply <waiver>      # mechanical edits to the tree
<author commits normally>  # full subject/body/footer, linted by commitlint
waiver embed <waiver>      # amend HEAD, inserting the waiver block body-before-footer
```

This routes message composition through the normal, linted path and lets the block
ride along after the fact.

**`waiver commit` stays** as a one-shot convenience wrapper (`apply` + a generic
commit + `embed`), no longer the only path. It should compose the new `embed` helper
rather than the current hard-coded `embedWaiver(subject, …)`, so both paths produce
identical, footer-safe embeddings.

## Affected files

- `src/commit-waiver.ts` — generalize `embedWaiver` into a helper that inserts the
  block **before the trailer paragraph** of an arbitrary message (subject/body/footer),
  not just after a bare subject.
- New `src/embed.ts` (command body) — read `HEAD`'s full message (`git log -1
  --format=%B`), inject the block, `git commit --amend`. Refuse if `HEAD` already
  carries a waiver block (would create the ≥2-blocks `invalid`, §17.1).
- `src/commit.ts` — rebuild `commitWaiver` on top of the new helper/`embed`.
- `src/cli.ts` — register the `embed` command (mirrors `apply`'s `<waiver>` arg).
- `docs/spec.md` §17.4 — document the `apply → commit → embed` flow; `waiver commit`
  demoted to convenience wrapper.
- `README.md` (CLI section, ~lines 126-133) — add `waiver embed`; note the flow.
- `plugin/skills/refactor-with-waiver/SKILL.md` — update the authoring loop to prefer
  `apply` + normal commit + `embed` when a body/footer is wanted.

## Open questions

- Should `embed` be strict about the trailer split (git-interpret-trailers semantics),
  or use a simpler "last blank-line-separated paragraph that is all `Key: value`"
  heuristic? (Proposal: reuse `git interpret-trailers --parse` to find the boundary so
  we agree with commitlint.)
- If `HEAD`'s message has *no* body and no footer (subject only), `embed` degenerates
  to today's `embedWaiver` output — confirm that's the intended fallback.
- Does `embed` need a dirty-tree guard like `commit` (`src/commit.ts:28-29`)? Amending
  only rewrites the message, so probably not — but an unrelated staged change would be
  folded into the amend. (Proposal: refuse if the index is non-empty.)

## Migration & compatibility

Additive. `waiver commit` keeps its signature and output shape (subject + block), so
existing callers and the skill's current one-shot path are unaffected. Existing
embedded waivers extract identically — `extractWaiverBlock` never depended on
placement. The only new capability is that authors who want a body or trailers now
have a path that doesn't fight commitlint.

---

## Decision (supersedes the proposal above)

The proposal above — add `waiver embed`, keep `waiver commit` as a wrapper — was
**rejected**. It kept, and multiplied, the friction that comes from sharing the commit
*message* channel with commitlint and `semantic-release`: `--amend` re-running the
hook, `--no-verify`, body-before-footer placement machinery, ≥2-block/decoy rules. We
briefly considered moving the waiver to **git notes** (a separate per-commit channel,
which deletes all of that) but chose to **keep the message channel** for human
visibility and zero notes-plumbing.

What we chose instead is a **verifier-only** tool with a much smaller surface. Reasoning,
from the point of view of the LLM that authors the commit: it wants to *make the edits,
commit normally, and confirm the commit is provable* — it does not want to manage refs,
message formatting, or a bespoke commit wrapper.

**Decisions:**

1. **Delete `waiver commit`.** There is no authoring command. A waivered commit is an
   ordinary commit whose body carries the block, written through the normal (linted)
   commit path.
2. **Delete `waiver check`.** Redundant in this flow: `apply` catches schema/selector
   errors; `verify` catches guards/coverage/emit (and any post-edit mismatch), folding
   over the committed base — which is *more* correct than `check`'s current-tree guards.
3. **Fence is ` ```waiver `, not ` ```json `.** Self-identifying; selection is by fence,
   not by sniffing every json block for `schema` (the decoy-first-block concern
   disappears). GitHub does not syntax-highlight fenced blocks in commit messages
   anyway, so no rendering is lost. `schema` is still validated, for versioning.
4. **Swap the command names.** `waiver verify [<commit>]` verifies **one commit**
   (default `HEAD`), reading its embedded waiver and folding `commit^..commit`.
   `waiver stamp --base --head` **rubber-stamps a PR** — it verifies every commit in the
   range and emits the aggregate APPROVE/COMMENT/REQUEST_CHANGES/ABSTAIN verdict. The
   metaphor holds: a PR is *stamped* (approved) exactly when every commit is *stamped*.
5. **Reads-from-commit, implicit refs.** Neither `verify` nor `stamp` takes a waiver
   file — the waiver travels in the commit. `verify` defaults to `HEAD`; only `stamp`
   (CI) takes an explicit range. The old file-based `stamp <file> --base --head`
   primitive is removed. `apply` is the only file-taking command.
6. **commitlint carve-out.** Set `body-max-line-length: [0]` in `commitlint.config.js`
   so a long JSON line in the body doesn't trip the single `commit-msg` hook run. This
   is the message channel's one standing tax; consumers who lint bodies must do the same
   (documented in the README).
7. **MCP mirrors the CLI.** Drop `waiver_check`; `waiver_verify` reads a commit,
   `waiver_stamp` aggregates a range.
8. **Out-of-range parents: verify against the true parent rather than skip** — stricter
   than the earlier spec text (which promised an `out-of-range` skip) and still safe
   (strictly more verification, never less); the spec text was amended accordingly.

Resulting surface: **`apply` / `verify` / `stamp` / `mcp`**. See spec §10, §16, §17, §18.

**Implementation note (dogfooding).** The `stamp`↔`verify` rename is a *swap*, so a naive
sequential symbol-rename collides — `waiver apply` can drive it only with a simultaneous
rename or an intermediate name, and it won't touch the CLI command strings or the spec
prose regardless.

### Affected files (verifier-only)

- `src/commit.ts` — **deleted** (`waiver commit` gone).
- `src/check.ts` — **deleted** (`waiver check` gone); guard logic already lives in the
  verify/stamp engine.
- `src/commit-waiver.ts` — drop `embedWaiver`; keep `extractWaiverBlock`, switching the
  fence from ` ```json ` to ` ```waiver ` (regex `JSON_FENCE` → a `waiver`-fence match;
  selection by fence, `schema` still validated).
- `src/stamp.ts` → the **single-commit** verifier (was `verify` semantics): read a
  commit's embedded waiver, fold `commit^..commit`. Renamed to `verify` (the swap).
- `src/verify.ts` → the **range aggregator** (was walking + verdict). Renamed to `stamp`
  (the swap).
- `src/cli.ts` — commands become `apply` / `verify [<commit>]` / `stamp --base --head` /
  `mcp`; remove `commit` and `check`; `verify` default `HEAD`.
- `src/mcp.ts` — drop `waiver_check`; `waiver_verify {commit?}`, `waiver_stamp {base,head}`.
- `src/errors.ts` — `DirtyTreeError` likely becomes unused (was `commit`-only) → remove.
- `commitlint.config.js` — add `rules: { 'body-max-line-length': [0] }`.
- `.github/workflows/ci.yml` — CLI smoke test no longer runs `check`; retarget to `apply`
  a fixture (or `verify` a fixture commit).
- `plugin/skills/refactor-with-waiver/SKILL.md`, `README.md` — new flow + `body-max-line-length`
  adoption note; drop `waiver commit`/`check`.
- `docs/spec.md` — §4, §10, §16, §17.1–17.5, §18.1–18.3, §20, §21 (done in this pass).

### Test plan

**Format (`extractWaiverBlock`, ` ```waiver ` fence)**
1. A ` ```waiver ` block with `schema: waiver-stamp/v0` → `one`; a ` ```json ` block with
   identical content in the same message is **ignored** (not selected).
2. Zero ` ```waiver ` blocks → `none` (unwaivered), even if a decoy ` ```json ` waiver-shaped
   block is present.
3. Two ` ```waiver ` blocks → `invalid` (multiple).
4. A ` ```waiver ` block whose JSON fails to parse / wrong `schema` → `invalid`.
5. CRLF / trailing-whitespace tolerance; >64 KiB → `invalid`.

**`verify` (single commit)**
6. `verify` (no arg) on a HEAD carrying a valid waiver whose ops fully cover the diff →
   **stamped**, exit 0; `--json` single-commit report.
7. `verify <sha>` on an explicit commit works the same.
8. Under-covering / guard-violating embedded waiver → **invalid**, exit 1 — caught locally.
9. Commit with no ` ```waiver ` block → **unwaivered**, exit 1.
10. Root commit (no parent) → malformed invocation, exit 2.
11. Merge commit → **skipped** (`merge-commit`), exit 0.
12. Non-existent commit-ish → malformed invocation, exit 2.

**`stamp` (range / PR)**
13. Range where every commit is stamped → **APPROVE**, exit 0.
14. Range with a stamped + an unwaivered commit → **COMMENT**, exit 0.
15. Range with an invalid commit → **REQUEST_CHANGES**, exit 1.
16. Range with zero waivered commits → **ABSTAIN**, exit 0.
17. Merge / out-of-range first-parent commits skipped with reason (unchanged §17.1/17.2).

**Authoring integration (tmp git repo)**
18. `apply` → `git commit -F` (subject + body + ` ```waiver ` block before a `Refs:` trailer)
    → `verify` → stamped; `git interpret-trailers --parse HEAD` still returns the footer
    (trailer stayed terminal); `stamp HEAD^..HEAD` → APPROVE.
19. A commit whose body has a >100-char JSON line is accepted by the `commit-msg` hook
    (assert `body-max-line-length` disabled).

**Surface / deletion**
20. `waiver commit …` and `waiver check …` → unknown-command errors; `waiver --help` lists
    only `apply` / `verify` / `stamp` / `mcp`.
21. MCP exposes `waiver_apply` / `waiver_verify` / `waiver_stamp`, not `waiver_check`.

**Docs (reviewed, not unit-tested)**
22. SKILL.md + README describe apply → normal commit with ` ```waiver ` block → `verify`;
    no `commit`/`check`; note `verify` defaults to HEAD and the commitlint tax.
