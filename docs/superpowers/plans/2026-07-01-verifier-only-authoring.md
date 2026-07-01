# Verifier-Only Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the commit-authoring surface to a verifier-only model — delete `waiver commit` and `waiver check`, carry the waiver in a ` ```waiver ` fence, and swap the command names so `waiver verify` checks one commit and `waiver stamp` rubber-stamps a PR range.

**Architecture:** The waiver still travels in the commit message (§17.1), but the tool becomes a pure verifier: `apply` (file → tree), `verify` (one commit → classification), `stamp` (range → aggregate verdict), `mcp`. The §3.1 fold primitive (`stampWaiver`) moves to a command-neutral module so the two command modules can reference each other without an import cycle.

**Tech Stack:** TypeScript (ESM, NodeNext), ts-morph, commander, `@modelcontextprotocol/sdk`, Zod, Vitest, Biome, commitlint/husky, semantic-release.

## Global Constraints

- Module system: **ESM with `.js` import specifiers** (NodeNext). Match neighbours.
- Test runner: **Vitest**, tests co-located as `src/<name>.test.ts`. Run: `pnpm test` (all) or `pnpm exec vitest run src/<name>.test.ts` (one file).
- Gates that must stay green: `pnpm typecheck`, `pnpm lint` (Biome), `pnpm build`, `pnpm test`.
- The embedded fence info-string is exactly **`waiver`** (not `json`). Selection is by fence; root `schema` must equal `"waiver-stamp/v0"` exactly.
- Errors: data in structured properties, never interpolated into the message string (see `src/errors.ts`).
- Exit codes (`src/report.ts` `EXIT`): `0` STAMPED, `1` FAILURE, `2` MALFORMED, `3` INTERNAL.
- Commit messages via the `git-commit` skill: `feat:`/`fix:`/`docs:` only, no ticket trailer (branch `jsalvata/v0-engine-mcp-skill` has no Jira segment).
- Spec of record: `docs/spec.md` §4, §10, §16, §17, §18; decision + test plan in `docs/design/commit-embed-split.md`.

---

## PR Plan

Reasoning order: feature spike → prep → cleanup. Ship order: 1 → 2 → 3.

- **PR 1 — Prep refactor** (`prep-stamp-core` off `jsalvata/v0-engine-mcp-skill`): move the §3.1 fold primitive `stampWaiver` (and its private helpers) from `src/stamp.ts` into a new `src/stamp-core.ts`; repoint importers. **Removes friction:** after the name swap, `stamp.ts` (range) must import `classifyCommit` from `verify.ts`, which imports `stampWaiver` — leaving the primitive in `stamp.ts` creates a `stamp.ts ↔ verify.ts` import cycle. Doing the move now (behavior-preserving, cheap) means the cycle never forms. Small but load-bearing.
- **PR 2 — Feature** (`verifier-only-authoring` off `prep-stamp-core`): the behavior change — fence swap, delete `commit`/`check`, swap `verify`/`stamp` semantics, implicit refs, MCP + commitlint + CI + docs.
- **PR 3 — Cleanup refactor** (`cleanup-verifier-only` off `verifier-only-authoring`): remove `DirtyTreeError` (dead after `commit.ts` is deleted) and its CLI handler; orphan audit.

Candidate prep for next time: the report type names `StampReport`/`VerifyReport` end up semantically swapped vs. the commands (the aggregate `VerifyReport` is what `stamp` now returns). Renaming collides (`StampReport` is the primitive result). Left as an internal naming nit — the CLI/`--json` surface is unaffected. If a future change touches these types, rename then.

---

## PR 1 — Prep refactor: extract `stamp-core.ts`

**Branch:** `jsalvata/v0-engine-mcp-skill` → create `jsalvata/prep-stamp-core` (use the `git-branch` skill).

Behavior-preserving. `stampWaiver` and every private helper in `src/stamp.ts` move verbatim to `src/stamp-core.ts`; `src/stamp.ts` keeps its public `stamp(path, …)` file-based CLI wrapper, now importing the primitive. No test *behavior* changes — only import paths.

### Task 1: Move `stampWaiver` into `src/stamp-core.ts`

**Files:**
- Create: `src/stamp-core.ts`
- Modify: `src/stamp.ts`
- Modify: `src/verify.ts:10` (import path), `src/mcp.ts:14` (import path)
- Test: existing `src/stamp.test.ts`, `src/verify.test.ts`, `src/mcp.test.ts` must stay green unchanged.

**Interfaces:**
- Produces: `src/stamp-core.ts` exports `stampWaiver(waiver: Waiver, options: StampOptions): Promise<StampReport>` and `interface StampOptions { base: string; head: string; cwd?: string }` — byte-identical to today's `stampWaiver`.
- Consumes: nothing new.

- [ ] **Step 1: Run the suite green first (baseline).**

Run: `pnpm test`
Expected: PASS (record the count; it must not drop).

- [ ] **Step 2: Create `src/stamp-core.ts`** with the entire current body of `src/stamp.ts` **except** the file-based `stamp(path, options)` wrapper (lines 35-38). That is: `StampOptions`, `stampWaiver`, and all private helpers (`applyExclusionOp`, `applyTransform`, `buildCompareSet`, `filesEquivalent`, `readOrEmpty`, and the `TS_SOURCE`/`DECLARATION`/`Project` locals), plus their imports. Keep the file header comment describing the §3.1 stamping principle.

- [ ] **Step 3: Reduce `src/stamp.ts` to the file-based wrapper.** It now reads:

```ts
/** File-based stamping CLI seam (§10). Reads a waiver file and stamps a base/head diff. */
import { loadWaiver } from './load.js';
import type { StampReport } from './report.js';
import { type StampOptions, stampWaiver } from './stamp-core.js';

export type { StampOptions } from './stamp-core.js';

export async function stamp(path: string, options: StampOptions): Promise<StampReport> {
  return stampWaiver(await loadWaiver(path), options);
}
```

- [ ] **Step 4: Repoint importers.** In `src/verify.ts` change `import { stampWaiver } from './stamp.js';` → `from './stamp-core.js';`. In `src/mcp.ts` change `import { stampWaiver } from './stamp.js';` → `from './stamp-core.js';`.

- [ ] **Step 5: Verify green + no behavior drift.**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, same test count as Step 1.

- [ ] **Step 6: Lint.**

Run: `pnpm lint`
Expected: PASS (no unused imports left in `src/stamp.ts`).

- [ ] **Step 7: Commit (git-commit skill).**

Message: `refactor: extract stampWaiver into stamp-core` — wait, the skill forbids `refactor:`. Use `feat:`? No behavior change, so `docs:` is wrong too. **Use the git-commit skill**; if it rejects the pure-refactor prefix, use `feat: split stampWaiver into stamp-core module` with a body noting it is behavior-preserving prep for the verify/stamp swap.

- [ ] **Step 8: Open PR 1 (git-pull-request skill)** — title notes it is prep #1 of a 3-PR stack; body states PR 2 (`verifier-only-authoring`) branches off this one.

---

## PR 2 — Feature: verifier-only authoring

**Branch:** `jsalvata/prep-stamp-core` → create `jsalvata/verifier-only-authoring` (git-branch skill).

### Task 2: Switch the embedded fence to ` ```waiver ` and drop `embedWaiver`

**Files:**
- Modify: `src/commit-waiver.ts`
- Modify: `src/commit-waiver.test.ts`
- Modify: `src/test-helpers.ts` (add a test-only block builder)

**Interfaces:**
- Produces: `extractWaiverBlock(message: string): WaiverBlock` unchanged in signature; internally selects ` ```waiver ` fences. `embedWaiver` is **removed**.
- Produces (test helper): `src/test-helpers.ts` exports `waiverCommitMessage(subject: string, waiver: Waiver): string` returning `` `${subject}\n\n\`\`\`waiver\n${JSON.stringify(waiver, null, 2)}\n\`\`\`\n` ``.
- Consumes: nothing new.

- [ ] **Step 1: Add the test-only helper** to `src/test-helpers.ts`:

```ts
import type { Waiver } from './types.js';

/** Build a commit message embedding `waiver` as a ` ```waiver ` block (test-only; §17.1). */
export function waiverCommitMessage(subject: string, waiver: Waiver): string {
  return `${subject}\n\n\`\`\`waiver\n${JSON.stringify(waiver, null, 2)}\n\`\`\`\n`;
}
```

- [ ] **Step 2: Write the failing fence test** in `src/commit-waiver.test.ts` (replace the tests that relied on `embedWaiver`/` ```json `):

```ts
import { describe, expect, it } from 'vitest';
import { extractWaiverBlock } from './commit-waiver.js';
import { waiverCommitMessage } from './test-helpers.js';
import type { Waiver } from './types.js';

const W: Waiver = { schema: 'waiver-stamp/v0', ops: [] };

describe('extractWaiverBlock — waiver fence (§17.1)', () => {
  it('selects a ```waiver block', () => {
    const block = extractWaiverBlock(waiverCommitMessage('refactor: x', W));
    expect(block.kind).toBe('one');
  });

  it('ignores an incidental ```json block with waiver-shaped content', () => {
    const msg = 'refactor: x\n\n```json\n{"schema":"waiver-stamp/v0","ops":[]}\n```\n';
    expect(extractWaiverBlock(msg).kind).toBe('none');
  });

  it('two ```waiver blocks → invalid', () => {
    const msg = `${waiverCommitMessage('a', W)}\n${waiverCommitMessage('b', W)}`;
    expect(extractWaiverBlock(msg).kind).toBe('invalid');
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (still matching ` ```json `).

Run: `pnpm exec vitest run src/commit-waiver.test.ts`
Expected: FAIL (first test: `none` instead of `one`).

- [ ] **Step 4: Change the fence + remove `embedWaiver`** in `src/commit-waiver.ts`:
  - Update the header comment: "a fenced ` ```waiver ` block".
  - Change the regex: `const JSON_FENCE = /```json[^\n]*\n([\s\S]*?)```/g;` → `const WAIVER_FENCE = /```waiver[^\n]*\n([\s\S]*?)```/g;` and update the `matchAll(JSON_FENCE)` call to `matchAll(WAIVER_FENCE)`.
  - Delete the `embedWaiver(subject, waiver)` function (lines 66-70) entirely.
  - Selection logic is otherwise unchanged (still parse JSON, require `schema === SCHEMA_VERSION`, 0→none / 1→validate / ≥2→invalid).

- [ ] **Step 5: Run green.**

Run: `pnpm exec vitest run src/commit-waiver.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit** (git-commit skill): `feat: embed waivers in a waiver-fenced block`.

### Task 3: Export `classifyCommit`; give `verify` single-commit semantics; move range logic to `stamp`

**Files:**
- Modify: `src/verify.ts` (single-commit `verify`; export `classifyCommit`; remove range `verify`/`aggregate`)
- Modify: `src/stamp.ts` (becomes the range aggregator + `aggregate`; delete file-based `stamp(path)`)
- Modify: `src/git.ts` (add `resolveCommit`)
- Modify: `src/errors.ts` (add `CommitResolutionError`)
- Modify/rename tests: `src/verify.test.ts`, `src/stamp.test.ts`

**Interfaces:**
- Produces: `src/git.ts` — `resolveCommit(repo: string, ref: string): Promise<string>` (resolves `ref^{commit}`; throws `CommitResolutionError` on failure).
- Produces: `src/errors.ts` — `class CommitResolutionError extends Error { readonly ref: string }`.
- Produces: `src/verify.ts` — `classifyCommit(cwd: string, sha: string): Promise<PerCommitResult>` (exported), and `verify(options?: { commit?: string; cwd?: string }): Promise<PerCommitResult>` (default `commit = 'HEAD'`).
- Produces: `src/stamp.ts` — `stamp(options: { base: string; head: string; cwd?: string }): Promise<VerifyReport>` and `aggregate(commits): Verdict`.
- Consumes: `classifyCommit` (stamp.ts imports it from verify.ts); `stampWaiver` (verify.ts imports from stamp-core.ts).

- [ ] **Step 1: Add `resolveCommit` to `src/git.ts`:**

```ts
import { CommitResolutionError } from './errors.js';

/** Resolve a commit-ish to a full SHA; throws CommitResolutionError if it is not a commit. */
export async function resolveCommit(repo: string, ref: string): Promise<string> {
  try {
    return await runGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new CommitResolutionError(ref);
  }
}
```

- [ ] **Step 2: Add `CommitResolutionError` to `src/errors.ts`:**

```ts
/** A commit-ish argument did not resolve to a commit (§10 malformed invocation). */
export class CommitResolutionError extends Error {
  override readonly name = 'CommitResolutionError';
  constructor(readonly ref: string) {
    super('Argument did not resolve to a commit');
  }
}
```

- [ ] **Step 3: Write the failing single-commit `verify` test.** Replace the aggregation tests in `src/verify.test.ts` with single-commit tests (the aggregation tests move to `stamp.test.ts` in Step 7). Use the harness + `waiverCommitMessage`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo, waiverCommitMessage } from './test-helpers.js';
import type { Waiver } from './types.js';
import { verify } from './verify.js';

const ORDERS_BASE = 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n';
const ORDERS_RENAMED = 'export function computeTotal(n: number): number {\n  return n * 2;\n}\n';
const renameWaiver = (): Waiver => ({
  schema: 'waiver-stamp/v0',
  ops: [{ op: 'rename', target: { file: 'src/orders.ts', symbol: 'calculateTotal' }, to: 'computeTotal' }],
});

let g: GitRepoFixture | undefined;
afterEach(async () => { await g?.cleanup(); g = undefined; });

describe('verify — single commit (§17.4)', () => {
  it('stamps HEAD when the embedded waiver covers the diff', async () => {
    g = await makeGitRepo();
    await g.commit({ 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE }, 'base');
    await g.commit({ 'src/orders.ts': ORDERS_RENAMED }, waiverCommitMessage('refactor: rename', renameWaiver()));
    const r = await verify({ cwd: g.repo }); // default HEAD
    expect(r.class).toBe('stamped');
  });

  it('an unwaivered HEAD → unwaivered', async () => {
    g = await makeGitRepo();
    await g.commit({ 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE }, 'base');
    await g.commit({ 'src/orders.ts': `${ORDERS_BASE}// note\n` }, 'chore: touch');
    expect((await verify({ cwd: g.repo })).class).toBe('unwaivered');
  });

  it('a root commit is skipped', async () => {
    g = await makeGitRepo();
    const root = await g.commit({ 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE }, 'base');
    const r = await verify({ commit: root, cwd: g.repo });
    expect(r.class).toBe('skipped');
    expect(r.reasons).toContain('root-commit');
  });

  it('an unresolvable commit-ish throws CommitResolutionError', async () => {
    g = await makeGitRepo();
    await g.commit({ 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE }, 'base');
    await expect(verify({ commit: 'nope-not-a-ref', cwd: g.repo })).rejects.toThrow('did not resolve');
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (`verify` still takes `{base, head}` and returns a `VerifyReport`).

Run: `pnpm exec vitest run src/verify.test.ts`
Expected: FAIL (type/shape mismatch).

- [ ] **Step 5: Rewrite `src/verify.ts`** to the single-commit form (keep `classifyCommit` as-is but **exported**; drop the range walk and `aggregate`, which move to `stamp.ts`):

```ts
/** Single-commit verification (§17.4): classify one commit by its embedded waiver. */
import { extractWaiverBlock } from './commit-waiver.js';
import { commitMessage, commitSubject, parents, resolveCommit } from './git.js';
import type { PerCommitResult } from './report.js';
import { stampWaiver } from './stamp-core.js';

export interface VerifyOptions {
  /** Commit-ish to verify. Defaults to HEAD. */
  commit?: string;
  /** Repo path. Defaults to process.cwd(). */
  cwd?: string;
}

export async function verify(options: VerifyOptions = {}): Promise<PerCommitResult> {
  const cwd = options.cwd ?? process.cwd();
  const sha = await resolveCommit(cwd, options.commit ?? 'HEAD');
  return classifyCommit(cwd, sha);
}

export async function classifyCommit(cwd: string, sha: string): Promise<PerCommitResult> {
  const subject = await commitSubject(cwd, sha);
  const base = { sha, subject, perOpFindings: [], uncoveredFiles: [] };

  const ps = await parents(cwd, sha);
  if (ps.length !== 1 || !ps[0]) {
    return { ...base, class: 'skipped', reasons: [ps.length >= 2 ? 'merge-commit' : 'root-commit'] };
  }

  const block = extractWaiverBlock(await commitMessage(cwd, sha));
  if (block.kind === 'none') return { ...base, class: 'unwaivered', reasons: [] };
  if (block.kind === 'invalid') return { ...base, class: 'invalid', reasons: [block.reason] };

  const report = await stampWaiver(block.waiver, { base: ps[0], head: sha, cwd });
  return {
    ...base,
    class: report.stamped ? 'stamped' : 'invalid',
    reasons: report.failures,
    perOpFindings: report.ops,
    uncoveredFiles: report.uncovered,
  };
}
```

- [ ] **Step 6: Run green (verify unit).**

Run: `pnpm exec vitest run src/verify.test.ts`
Expected: PASS.

- [ ] **Step 7: Replace `src/stamp.ts`** with the range aggregator (the old `verify` body + `aggregate`), importing `classifyCommit`:

```ts
/**
 * PR-level rubber-stamp (§17.2): walk base..head, classify each commit by its embedded
 * waiver, and aggregate to a single verdict. Only APPROVE removes review.
 */
import { commitsInRange } from './git.js';
import type { PerCommitResult, Verdict, VerifyReport } from './report.js';
import { classifyCommit } from './verify.js';

export interface StampOptions {
  base: string;
  head: string;
  /** Repo path. Defaults to process.cwd(). */
  cwd?: string;
}

export async function stamp(options: StampOptions): Promise<VerifyReport> {
  const cwd = options.cwd ?? process.cwd();
  const shas = await commitsInRange(cwd, options.base, options.head);
  const commits: PerCommitResult[] = [];
  for (const sha of shas) commits.push(await classifyCommit(cwd, sha));
  return { verdict: aggregate(commits), commits };
}

/** Highest-severity verdict present: REQUEST_CHANGES > COMMENT > APPROVE > ABSTAIN (§17.2). */
export function aggregate(commits: readonly PerCommitResult[]): Verdict {
  const hasInvalid = commits.some((c) => c.class === 'invalid');
  const hasStamped = commits.some((c) => c.class === 'stamped');
  const hasUnwaivered = commits.some((c) => c.class === 'unwaivered');
  if (hasInvalid) return 'REQUEST_CHANGES';
  if (hasStamped && hasUnwaivered) return 'COMMENT';
  if (hasStamped) return 'APPROVE';
  return 'ABSTAIN';
}
```

Note: this removes the file-based `stamp(path, …)` seam. `stampWaiver` lives in `stamp-core.ts` (PR 1) and is unaffected.

- [ ] **Step 8: Move the aggregation/verdict-matrix tests** from the old `verify.test.ts` into `src/stamp.test.ts`, renaming the call `verify({ base, head, cwd })` → `stamp({ base, head, cwd })` and `import { ... } from './stamp.js'`. Update message construction from `embedWaiver(subject, w)` → `waiverCommitMessage(subject, w)`. Keep the four verdict cases (APPROVE/COMMENT/REQUEST_CHANGES/ABSTAIN) and the `aggregate` unit tests.

- [ ] **Step 9: Delete the old file-based `stamp` tests** in `src/stamp.test.ts` that call `stamp('<path>', {base, head})` (the file-based seam is gone). The §3.1 primitive is still covered by the range/verify tests that fold real diffs.

- [ ] **Step 10: Run green (both units).**

Run: `pnpm exec vitest run src/verify.test.ts src/stamp.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit** (git-commit skill): `feat: swap verify (one commit) and stamp (a PR range)`.

### Task 4: Delete `commit` and `check`

**Files:**
- Delete: `src/commit.ts`, `src/commit.test.ts`, `src/check.ts`, `src/check.test.ts`

**Interfaces:** removes `commitWaiver`, `commit`-related exports, and `check`/`CheckResult`.

- [ ] **Step 1: Delete the four files.**

```bash
git rm src/commit.ts src/commit.test.ts src/check.ts src/check.test.ts
```

- [ ] **Step 2: Confirm nothing imports them** (cli.ts still does — fixed in Task 5).

Run: `pnpm exec vitest run` — expect FAIL only from `src/cli` / `src/mcp` compile references (fixed next). If any *other* file imports `commit`/`check`, that is a surprise — stop and investigate.

- [ ] **Step 3: Commit** (git-commit skill): `feat: remove waiver commit and check commands`. (Commit after Task 5 if you prefer a compiling checkpoint; both are fine since PR 2 is one reviewable unit.)

### Task 5: Rewire the CLI

**Files:**
- Modify: `src/cli.ts`

**Interfaces:** commands become `apply`, `verify [<commit>]`, `stamp --base --head`, `check`(removed), `commit`(removed), `mcp`. New exit mapping for `CommitResolutionError`.

- [ ] **Step 1: Write a failing CLI test** (`src/cli.test.ts` — create if absent) asserting the command surface:

```ts
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

describe('CLI surface (§10)', () => {
  it('exposes apply/verify/stamp/mcp and not commit/check', async () => {
    const { stdout } = await run('node', ['dist/cli.js', '--help']);
    for (const c of ['apply', 'verify', 'stamp', 'mcp']) expect(stdout).toContain(c);
    for (const c of ['commit', 'check']) expect(stdout).not.toContain(`\n  ${c}`);
  });
});
```

(Requires `pnpm build` first; if you prefer to avoid building in unit tests, assert the command list by importing the built `program` instead — but keep the intent: `verify`/`stamp` present, `commit`/`check` absent.)

- [ ] **Step 2: Run it — expect FAIL** (build still registers `commit`/`check`).

- [ ] **Step 3: Rewrite the command registrations in `src/cli.ts`.** Remove the `commitWaiver`/`check` imports and their `program.command('commit')` / `program.command('check')` blocks. Replace the `stamp` and `verify` commands:

```ts
import { stamp } from './stamp.js';
import { verify } from './verify.js';

program
  .command('verify')
  .argument('[commit]', 'commit-ish to verify (default HEAD)')
  .option('--json', 'emit a machine-readable report')
  .description('verify one commit against its embedded waiver (§17.4)')
  .action(async (commit: string | undefined, opts: { json?: boolean }) => {
    await run(async () => {
      const r = await verify({ commit, cwd: process.cwd() });
      if (opts.json) console.log(JSON.stringify(r, null, 2));
      else {
        console.log(`${r.class.padEnd(10)} ${r.sha.slice(0, 8)} ${r.subject}`);
        for (const reason of r.reasons) console.log(`  - ${reason}`);
      }
      if (r.class === 'invalid' || r.class === 'unwaivered') setExit(EXIT.FAILURE);
      // stamped / skipped → default STAMPED (0)
    });
  });

program
  .command('stamp')
  .requiredOption('--base <ref>', 'base git ref')
  .requiredOption('--head <ref>', 'head git ref')
  .option('--json', 'emit a machine-readable report')
  .description('aggregate the per-commit PR verdict over base..head (§17.2)')
  .action(async (opts: { base: string; head: string; json?: boolean }) => {
    await run(async () => {
      const report = await stamp({ base: opts.base, head: opts.head, cwd: process.cwd() });
      if (opts.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`verdict: ${report.verdict}`);
        for (const c of report.commits) console.log(`  ${c.sha.slice(0, 8)} ${c.class.padEnd(10)} ${c.subject}`);
      }
      if (report.verdict === 'REQUEST_CHANGES') setExit(EXIT.FAILURE);
    });
  });
```

- [ ] **Step 4: Map `CommitResolutionError` to exit 2** in the `run()` catch chain (alongside the existing `WaiverParseError` etc.):

```ts
} else if (err instanceof CommitResolutionError) {
  console.error(`error: '${err.ref}' does not resolve to a commit`);
  setExit(EXIT.MALFORMED);
}
```

Add `CommitResolutionError` to the `./errors.js` import; remove the now-unused `DirtyTreeError` import only in PR 3 (leave it importable for now to keep the diff focused — or remove here if lint complains; either is fine, PR 3 finishes the sweep).

- [ ] **Step 5: Build + run the CLI test.**

Run: `pnpm build && pnpm exec vitest run src/cli.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit** (git-commit skill): `feat: cli exposes apply/verify/stamp only`.

### Task 6: Realign the MCP surface to the CLI

**Files:**
- Modify: `src/mcp.ts`, `src/mcp.test.ts`

**Interfaces:** drop `waiver_check`; `waiver_verify` takes `{ commit?, cwd? }` → single-commit report; `waiver_stamp` takes `{ base, head, cwd? }` → aggregate report. `waiver_apply` unchanged.

- [ ] **Step 1: Update `src/mcp.test.ts`** — remove the `waiver_check` assertions; assert `waiver_verify` classifies a single embedded commit and `waiver_stamp` returns a verdict over a range (mirror the CLI tests, using `waiverCommitMessage` + the git harness). Keep `waiver_apply`.

- [ ] **Step 2: Run it — expect FAIL.**

Run: `pnpm exec vitest run src/mcp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `src/mcp.ts`:**
  - Remove the `waiver_check` `registerTool` block and the now-unused `loadWaiverFromObject`/`InlineWaiverSchema` imports **only if** `waiver_apply` no longer needs them (it does — keep them).
  - Change the imports: `import { stamp } from './stamp.js';` and keep `import { verify } from './verify.js';`.
  - Replace `waiver_stamp`:

```ts
server.registerTool(
  'waiver_stamp',
  {
    description: 'Aggregate the per-commit PR verdict over base..head (§17.2).',
    inputSchema: { base: z.string(), head: z.string(), cwd: z.string().optional() },
  },
  async ({ base, head, cwd }) => {
    try { return ok(await stamp({ base, head, cwd: cwd ?? process.cwd() })); }
    catch (err) { return fail(err); }
  },
);
```

  - Replace `waiver_verify`:

```ts
server.registerTool(
  'waiver_verify',
  {
    description: 'Verify one commit against its embedded waiver (§17.4).',
    inputSchema: { commit: z.string().optional(), cwd: z.string().optional() },
  },
  async ({ commit, cwd }) => {
    try { return ok(await verify({ commit, cwd: cwd ?? process.cwd() })); }
    catch (err) { return fail(err); }
  },
);
```

- [ ] **Step 4: Run green.**

Run: `pnpm exec vitest run src/mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (git-commit skill): `feat: mcp mirrors the cli (verify/stamp, no check)`.

### Task 7: commitlint carve-out + CI smoke test

**Files:**
- Modify: `commitlint.config.js`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Disable `body-max-line-length`** so an embedded ` ```waiver ` block's long JSON lines don't fail the `commit-msg` hook. `commitlint.config.js`:

```js
/** Conventional Commits — drives semantic-release versioning. */
export default {
  extends: ['@commitlint/config-conventional'],
  // Waivered commits embed a machine ```waiver block in the body; its JSON lines can
  // exceed 100 chars. The block is not prose, so the body line-length rule is disabled.
  rules: { 'body-max-line-length': [0, 'always', Infinity] },
};
```

- [ ] **Step 2: Verify the hook accepts a long body line.** Manually craft a commit whose body has a >100-char line and confirm `pnpm exec commitlint` (or a real commit) passes. (No unit test — this is a config assertion; a follow-up may add a scripted check.)

- [ ] **Step 3: Update the CI smoke test** in `.github/workflows/ci.yml`. Replace `run: node dist/cli.js check examples/valid.waiver.json` (the `check` command is gone) with a build-and-registration smoke:

```yaml
      - name: CLI smoke test
        run: node dist/cli.js --help | grep -Eq 'verify.*stamp|stamp.*verify' || node dist/cli.js verify --help
```

(Rationale: `check` no longer exists; `apply` mutates a tree and `verify`/`stamp` need a repo, so the smoke confirms the built binary runs and the commands are registered.)

- [ ] **Step 4: Commit** (git-commit skill): `feat: disable body-max-line-length; fix ci smoke`.

### Task 8: Docs — README + skill

**Files:**
- Modify: `README.md` (CLI section)
- Modify: `plugin/skills/refactor-with-waiver/SKILL.md`

- [ ] **Step 1: README CLI section** — replace `waiver commit`/`waiver check`/file-based `stamp` with the four verbs; document `verify` defaults to HEAD, `stamp --base --head`, the ` ```waiver ` fence, the authoring flow (apply → normal commit with the block before trailers → `verify`), and the `body-max-line-length` adoption note (§17.4.2).

- [ ] **Step 2: SKILL.md** — the authoring loop is: `waiver apply` (or hand-edit test/doc) → write a normal commit whose body carries the ` ```waiver ` block before any trailer → `waiver verify` to confirm. Remove references to `waiver commit`/`waiver check`. Keep the selector guidance and break-even advice.

- [ ] **Step 3: Full gate.**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit** (git-commit skill): `docs: readme + skill for verifier-only flow`.

- [ ] **Step 5: Open PR 2 (git-pull-request skill)** — title notes feature #2 of the stack; body states it branches off `prep-stamp-core` and that `cleanup-verifier-only` follows.

---

## PR 3 — Cleanup refactor

**Branch:** `jsalvata/verifier-only-authoring` → create `jsalvata/cleanup-verifier-only` (git-branch skill).

Behavior-preserving. Removes code that only existed for the deleted `commit` command.

### Task 9: Remove the dead `DirtyTreeError`

**Files:**
- Modify: `src/errors.ts` (remove `DirtyTreeError`)
- Modify: `src/cli.ts` (remove its import + catch branch, if still present)

- [ ] **Step 1: Grep for remaining uses.**

Run: `rtk proxy git grep -n DirtyTreeError`
Expected: only `src/errors.ts` and possibly `src/cli.ts`.

- [ ] **Step 2: Remove `DirtyTreeError`** from `src/errors.ts` and its `import`/`else if (err instanceof DirtyTreeError)` branch from `src/cli.ts` (if it wasn't already removed in Task 5).

- [ ] **Step 3: Orphan audit.** Grep for other symbols that only existed for `commit`/`check`:

Run: `rtk proxy git grep -nE 'embedWaiver|commitWaiver|CheckResult|\bcheck\(' src`
Expected: no hits (all removed). Any hit → remove or explain.

- [ ] **Step 4: Full gate.**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit** (git-commit skill): `refactor:`→ use the skill; if the prefix is rejected, `fix: drop dead DirtyTreeError after commit removal`.

- [ ] **Step 6: Open PR 3 (git-pull-request skill)** — cleanup #3 of the stack, off `verifier-only-authoring`.

---

## Self-Review (completed against `docs/spec.md`)

- **§10 CLI** → Tasks 5 (verify/stamp), 4 (remove check/commit). ✓
- **§17.1 ` ```waiver ` fence** → Task 2. ✓
- **§17.2 verify(one)/stamp(range)** → Task 3. ✓
- **§17.4 authoring flow + commitlint carve-out** → Tasks 3 (verify), 7 (commitlint), 8 (skill). ✓
- **§18.1 MCP mirrors CLI** → Task 6. ✓
- **§4 Verifier role, §16/§20/§21 command names** → already updated in the spec; no code beyond Tasks 3/5. ✓
- **Prep cycle-break** → PR 1. ✓
- **Dead-code residue** → PR 3. ✓

**Deferred (stated, not a gap):** the `StampReport`/`VerifyReport` type names remain internally swapped vs. the commands (see PR Plan "candidate prep for next time"). No CLI/`--json`/spec surface depends on the type identifiers, so this is left for a future change that touches those types.
