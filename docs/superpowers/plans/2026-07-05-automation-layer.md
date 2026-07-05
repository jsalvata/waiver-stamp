# Automation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the §18.3 automation layer — a reusable GitHub asset that turns a
`waiver stamp` verdict into a real GitHub review, correctly gated on the backstop, plus the
adoption docs and dogfooding — per `docs/automation-layer.md`.

**Architecture:** Two GitHub actions split across the privilege boundary. An **unprivileged
composite `waiver-stamp` action** runs `waiver stamp --json` as ordinary CI, writes a job
summary, and uploads the report as a run artifact. A **privileged JavaScript
`waiver-stamp-review` action** wakes on `workflow_run`, confirms the backstop checks are
green on the head SHA, re-establishes trust with two git-only guards (G1/G2), and posts the
mapped review. The reviewer reuses the engine's `ts-morph`-free helpers (`report.ts` types,
`deps.ts` gates, `git.ts` helpers, `config.ts` loader) so its bundle stays lean.

**Tech Stack:** TypeScript ESM (`.ts` import suffixes), Zod v4 (`zod/v4`), vitest,
`@actions/core`, `@actions/github` (Octokit), `@vercel/ncc` (action bundler), GitHub Actions
(composite + JavaScript actions, `workflow_run` trigger).

## Global Constraints

- Commands green at the end of every task: `pnpm test`, `pnpm typecheck`, `pnpm lint`
  (Biome). `pnpm gen:schema` regenerates the published JSON Schema; `pnpm build:action`
  (new) rebuilds the reviewer bundle.
- Commit rules (git-commit skill): prefixes `feat:`/`fix:`/`docs:` only, all lowercase,
  header ≤ 50 chars, no ticket trailer. **Never commit Mon–Fri 09:00–18:00 (+0200)** — run
  `date '+%A %H:%M %z'` first; inside the window, stop and report.
- ESM: all local imports use the `.ts` suffix (match `src/index.ts`); Zod from `'zod/v4'`.
- Errors: data in structured properties (e.g. `new AutomationError(code, detail)`), never
  interpolated into the message (error-construction skill).
- **Downside-bounded invariant (spec §1, §17.2):** the only verdict that removes review is
  `APPROVE`; every error/timeout/missing-check/ambiguity is fail-closed (no review or a
  neutral note). No code path may fabricate a verdict.
- **No second engine (spec §4):** the reviewer imports the existing engine helpers; it never
  re-implements stamping. It must not import `ts-morph` (keeps the bundle lean).
- Branches/PRs use the `git-branch` / `git-pull-request` skills, GitHub username `jsalvata`,
  no Jira ticket (this is the standalone waiver-stamp repo → `jsalvata/<slug>`).

---

## PR Plan

Reasoning order: feature spike → prep → cleanup. Ship order: 1 → 2 → 3.

- **PR 1 — Prep refactor.** *Skipped.* The spike found no friction: the reviewer's reuse
  targets (`report.ts`, `deps.ts`, `git.ts`, `config.ts`, `errors.ts`) are already cleanly
  separated from `ts-morph`, and the rest of the layer is greenfield (`.github/actions/*`,
  `src/action/*`, workflows, docs). No behavior-preserving restructuring would make the
  change easier, so a prep PR would be speculative generality.
- **PR 2 — Feature: the reviewer** (`jsalvata/automation-reviewer` off `main`): the
  privileged `waiver-stamp-review` JavaScript action (artifact schema, G1, G2, backstop
  confirmation, verdict→review mapping, review posting + self-heal, orchestration), its unit
  tests, the ncc bundle + drift-guard, and the small `stamp --json` `base`/`head` addition
  the artifact contract needs. Independently unit-tested with a mocked Octokit.
- **PR 3 — Feature: wiring, adoption & dogfood** (`jsalvata/automation-wiring` off the PR 2
  branch): the composite `waiver-stamp` action, this repo's CI wiring + `waiver-stamp-review`
  caller, `.waiver-stamp.json`, `zizmor`/`actionlint`, the adoption guide + `examples/`
  templates + README §20, and the real-PR e2e acceptance harness. Depends on PR 2's action
  existing.
- **PR 4 — Cleanup refactor.** *Evaluated at the end of PR 3 (see “Cleanup verdict”).*
  Expected to be skipped — a greenfield feature leaves little residue — but assessed
  explicitly, not assumed.

Candidate prep for next time: if a second consumer of the engine's pure helpers appears,
re-exporting `matchesAllowlist`/`manifestBumpViolations`/`git.ts` helpers from a dedicated
`src/engine/pure.ts` barrel (today the reviewer reaches into modules directly) would be a
justified prep — not yet, one consumer doesn't warrant it.

---

## File Structure

**PR 2 (reviewer):**
- `src/commands/report.ts` — **modify**: add `base`, `head` to `VerifyReport`.
- `src/commands/stamp.ts` — **modify**: populate `base`/`head` in the returned report.
- `src/action/schema.ts` — **create**: the zod artifact schema (`ArtifactReport`) + the
  action's config/inputs parsing.
- `src/action/guards.ts` — **create**: `g1WorkflowIntegrity`, `g2ManifestEnvelope` (git-only).
- `src/action/backstop.ts` — **create**: `confirmChecksGreen` (Octokit check-runs).
- `src/action/decide.ts` — **create**: `decideReview` — the pure §5 verdict→output matrix.
- `src/action/review.ts` — **create**: `postOutcome` — review/sticky-comment side effects +
  self-heal (Octokit).
- `src/action/main.ts` — **create**: the orchestrator (`run()`), fail-closed.
- `src/action/*.test.ts` — **create**: one test file per module above.
- `.github/actions/waiver-stamp-review/action.yml` — **create**: JS action manifest.
- `.github/actions/waiver-stamp-review/dist/index.js` — **generated**: ncc bundle (committed).
- `scripts/build-action.ts` + `package.json` — **modify**: `build:action` script, devDeps
  (`@actions/core`, `@actions/github`, `@vercel/ncc`), and the bundle drift-guard test.

**PR 3 (wiring/adoption):**
- `.github/actions/waiver-stamp/action.yml` — **create**: composite producer action.
- `.github/workflows/ci.yml` — **modify**: add the `waiver-stamp` producer job.
- `.github/workflows/waiver-stamp-review.yml` — **create**: the reviewer caller.
- `.github/workflows/actionlint.yml` — **create**: `zizmor` + `actionlint`.
- `.waiver-stamp.json` — **create**: dogfood config.
- `docs/adoption.md` — **create**: the adopter guide.
- `examples/waiver-stamp-ci.yml`, `examples/waiver-stamp-review.yml` — **create**: templates.
- `README.md` — **modify**: §20 step-4 wiring.
- `bench/e2e/` — **create**: the real-PR acceptance harness + fixtures.

---

# PR 2 — The reviewer action

### Task 1: Add `base`/`head` to the stamp report (artifact contract)

The artifact records the SHAs the stamp actually walked; the reviewer cross-checks `head`
against the `workflow_run` event. `stamp()` already resolves both — just surface them.

**Files:**
- Modify: `src/commands/report.ts`
- Modify: `src/commands/stamp.ts`
- Test: `src/commands/stamp.test.ts`

**Interfaces:**
- Produces: `VerifyReport` gains `base: string; head: string` (resolved SHAs). Task 3's
  `ArtifactReport` schema and Task 9 rely on these.

- [ ] **Step 1: Write the failing test**

Add to `src/commands/stamp.test.ts`:

```ts
// makeGitRepo is the existing helper in src/test-helpers.ts (already imported by this suite).
it('reports the resolved base and head SHAs it walked', async () => {
  const g = await makeGitRepo();
  const base = await g.commit({ 'a.txt': '1' }, 'init');
  const head = await g.commit({ 'a.txt': '2' }, 'change');
  const report = await stamp({ cwd: g.repo, base, head });
  expect(report.base).toBe(base);
  expect(report.head).toBe(head);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/commands/stamp.test.ts`
Expected: FAIL — `report.base` is `undefined`.

- [ ] **Step 3: Add the fields to the report type**

In `src/commands/report.ts`, extend `VerifyReport`:

```ts
export interface VerifyReport {
  /** The highest-severity verdict present (REQUEST_CHANGES > COMMENT > APPROVE > ABSTAIN). */
  verdict: Verdict;
  /** Resolved SHA the range was walked from (git first-parent floor). */
  base: string;
  /** Resolved SHA the range was walked to (the stamped head). */
  head: string;
  commits: PerCommitResult[];
}
```

- [ ] **Step 4: Populate them in `stamp()`**

In `src/commands/stamp.ts`, the resolved `base`/`head` already exist; include them:

```ts
  return { verdict: aggregate(commits), base, head, commits };
```

- [ ] **Step 5: Run tests to verify pass + no regressions**

Run: `pnpm test -- src/commands/stamp.test.ts && pnpm typecheck`
Expected: PASS. (`--json` output now carries `base`/`head`; additive, MCP unaffected.)

- [ ] **Step 6: Commit**

```bash
git add src/commands/report.ts src/commands/stamp.ts src/commands/stamp.test.ts
git commit -m "feat: surface base/head shas in the stamp report"
```

---

### Task 2: Scaffold the reviewer action + bundle tooling

Deliverable: an empty-but-building JavaScript action with a drift-guarded ncc bundle.

**Files:**
- Create: `.github/actions/waiver-stamp-review/action.yml`
- Create: `src/action/main.ts` (stub)
- Create: `scripts/build-action.ts`
- Modify: `package.json`
- Test: `src/action/build.test.ts`

**Interfaces:**
- Produces: `run(): Promise<void>` exported from `src/action/main.ts`; `pnpm build:action`
  emits `.github/actions/waiver-stamp-review/dist/index.js`.

- [ ] **Step 1: Add devDeps and the build script**

```bash
pnpm add -D @actions/core @actions/github @vercel/ncc
```

In `package.json` `scripts`, add:

```json
    "build:action": "ncc build src/action/main.ts -o .github/actions/waiver-stamp-review/dist --minify",
```

- [ ] **Step 2: Write the action manifest**

Create `.github/actions/waiver-stamp-review/action.yml`:

```yaml
name: waiver-stamp-review
description: Post the mapped GitHub review for a waiver-stamp verdict (privileged reviewer).
inputs:
  ci-checks:
    description: Newline/comma list of check-run names that must be success on the head SHA.
    required: false
    default: ''
  lockfile-honesty-checks:
    description: Newline/comma list of lockfile-honesty check-run names (empty ⇒ warn on approve).
    required: false
    default: ''
  github-token:
    description: Token that posts the review. Pass an App/bot-PAT to make APPROVE count.
    required: false
    default: ${{ github.token }}
runs:
  using: node20
  main: dist/index.js
```

- [ ] **Step 3: Write the stub entrypoint**

Create `src/action/main.ts`:

```ts
import * as core from '@actions/core';

export async function run(): Promise<void> {
  core.info('waiver-stamp-review: not yet implemented');
}

// ncc entry: invoke unless imported by a test.
if (process.env.VITEST === undefined) {
  run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
}
```

- [ ] **Step 4: Build the bundle**

Run: `pnpm build:action`
Expected: `.github/actions/waiver-stamp-review/dist/index.js` is created.

- [ ] **Step 5: Write the drift-guard test**

Create `src/action/build.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('reviewer bundle', () => {
  it('is up to date with source (run `pnpm build:action`)', () => {
    const path = '.github/actions/waiver-stamp-review/dist/index.js';
    const before = readFileSync(path, 'utf8');
    execFileSync('pnpm', ['build:action'], { stdio: 'ignore' });
    const after = readFileSync(path, 'utf8');
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 6: Run tests + commit**

Run: `pnpm test -- src/action/build.test.ts`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml scripts/build-action.ts src/action/main.ts \
  .github/actions/waiver-stamp-review
git commit -m "feat: scaffold the waiver-stamp-review action"
```

---

### Task 3: The artifact schema (`ArtifactReport`)

Validate the untrusted artifact before any use (spec §4.3, §3.4).

**Files:**
- Create: `src/action/schema.ts`
- Test: `src/action/schema.test.ts`

**Interfaces:**
- Consumes: `VerifyReport` shape from Task 1.
- Produces: `ArtifactReportSchema` (zod), `type ArtifactReport = z.infer<...>`,
  `parseArtifact(json: string): ArtifactReport` (throws on invalid). Tasks 8/9 consume it.

- [ ] **Step 1: Write the failing test**

Create `src/action/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseArtifact } from './schema.ts';

const valid = JSON.stringify({
  verdict: 'APPROVE',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  toolVersion: '1.8.2',
  commits: [{ sha: 'c'.repeat(40), subject: 'x', class: 'stamped', reasons: [], perOpFindings: [], uncoveredFiles: [] }],
});

describe('parseArtifact', () => {
  it('accepts a well-formed report', () => {
    expect(parseArtifact(valid).verdict).toBe('APPROVE');
  });
  it('rejects an unknown verdict', () => {
    const bad = valid.replace('APPROVE', 'YOLO');
    expect(() => parseArtifact(bad)).toThrow();
  });
  it('rejects a non-40-char head', () => {
    const bad = JSON.parse(valid); bad.head = 'short';
    expect(() => parseArtifact(JSON.stringify(bad))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/action/schema.test.ts`
Expected: FAIL — `parseArtifact` not defined.

- [ ] **Step 3: Implement the schema**

Create `src/action/schema.ts`:

```ts
import { z } from 'zod/v4';

const sha = z.string().regex(/^[0-9a-f]{40}$/);

const PerCommit = z.object({
  sha,
  subject: z.string(),
  class: z.enum(['stamped', 'invalid', 'unwaivered', 'skipped']),
  reasons: z.array(z.string()),
  perOpFindings: z.array(z.object({ op: z.string(), ok: z.boolean(), reason: z.string().optional() })),
  uncoveredFiles: z.array(z.string()),
});

export const ArtifactReportSchema = z.object({
  verdict: z.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES', 'ABSTAIN']),
  base: sha,
  head: sha,
  toolVersion: z.string(),
  commits: z.array(PerCommit),
});

export type ArtifactReport = z.infer<typeof ArtifactReportSchema>;

/** Parse + validate the untrusted artifact JSON; throws on any deviation (fail-closed). */
export function parseArtifact(json: string): ArtifactReport {
  return ArtifactReportSchema.parse(JSON.parse(json));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/action/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/action/schema.ts src/action/schema.test.ts
git commit -m "feat: validate the reviewer artifact with zod"
```

---

### Task 4: G1 — workflow-integrity guard

No commit in `base..head` may touch `.github/**` (per-commit, spec §3.2). Reuses `git.ts`.

**Files:**
- Create: `src/action/guards.ts`
- Test: `src/action/guards.test.ts`

**Interfaces:**
- Consumes: `commitsInRange`, `parents`, `changedFiles` from `src/git.ts`.
- Produces: `g1WorkflowIntegrity(repo: string, base: string, head: string): Promise<string[]>`
  — returns the offending SHAs (empty ⇒ pass). Task 9 consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/action/guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { g1WorkflowIntegrity } from './guards.ts';
import { makeGitRepo } from '../test-helpers.ts';
import { runGit } from '../git.ts';

describe('g1WorkflowIntegrity', () => {
  it('passes when no commit touches .github', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit({ 'src/a.ts': 'export const a = 2;' }, 'change');
    expect(await g1WorkflowIntegrity(g.repo, base, head)).toEqual([]);
  });
  it('flags a commit that touches .github even if a later commit reverts it', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    await g.commit({ '.github/workflows/ci.yml': 'name: x\n' }, 'add workflow'); // offender
    await runGit(g.repo, ['rm', '.github/workflows/ci.yml']);
    await runGit(g.repo, ['commit', '-m', 'revert workflow']);   // nets to zero, but the commit stands
    const head = await runGit(g.repo, ['rev-parse', 'HEAD']);
    expect((await g1WorkflowIntegrity(g.repo, base, head)).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/action/guards.test.ts`
Expected: FAIL — `g1WorkflowIntegrity` not defined.

- [ ] **Step 3: Implement G1**

In `src/action/guards.ts`:

```ts
import { changedFiles, commitsInRange, parents } from '../git.ts';

/** SHAs in base..head whose own diff touches .github/** (per-commit, not net). */
export async function g1WorkflowIntegrity(repo: string, base: string, head: string): Promise<string[]> {
  const offenders: string[] = [];
  for (const sha of await commitsInRange(repo, base, head)) {
    if ((await parents(repo, sha)).length !== 1) continue; // merges are skipped upstream
    const files = await changedFiles(repo, `${sha}^`, sha);
    if (files.some((f) => f === '.github' || f.startsWith('.github/'))) offenders.push(sha);
  }
  return offenders;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/action/guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/action/guards.ts src/action/guards.test.ts
git commit -m "feat: add the g1 workflow-integrity guard"
```

---

### Task 5: G2 — manifest-envelope guard

If any commit touches `package.json`/lockfile, independently re-run §6.3 gates 1–4 over the
range, reusing `deps.ts` and base's `.waiver-stamp.json` (spec §3.2). No execution.

**Files:**
- Modify: `src/action/guards.ts`
- Test: `src/action/guards.test.ts`

**Interfaces:**
- Consumes: `manifestBumpViolations` from `src/engine/deps.ts`; `loadConfig` from
  `src/engine/config.ts`; `changedFiles`, `worktreeAt`, `runGit` from `src/git.ts`.
- Produces: `g2ManifestEnvelope(repo, base, head): Promise<string[]>` — returns violation
  strings (empty ⇒ pass or no manifest change). Task 9 consumes it.

- [ ] **Step 1: Write the failing test**

Add to `src/action/guards.test.ts`:

```ts
import { g2ManifestEnvelope } from './guards.ts';

describe('g2ManifestEnvelope', () => {
  it('passes when no manifest/lockfile change', async () => {
    const g = await makeGitRepo();
    const base = await g.commit({ 'src/a.ts': 'export const a = 1;' }, 'init');
    const head = await g.commit({ 'src/a.ts': 'export const a = 2;' }, 'change');
    expect(await g2ManifestEnvelope(g.repo, base, head)).toEqual([]);
  });
  it('flags an out-of-envelope bump (not allowlisted)', async () => {
    const g = await makeGitRepo();
    const base = await g.commit(
      { '.waiver-stamp.json': '{"allowBumping":["lodash"]}', 'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}' },
      'init',
    );
    const head = await g.commit({ 'package.json': '{"dependencies":{"left-pad":"^2.0.0"}}' }, 'bump left-pad');
    expect((await g2ManifestEnvelope(g.repo, base, head)).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/action/guards.test.ts`
Expected: FAIL — `g2ManifestEnvelope` not defined.

- [ ] **Step 3: Implement G2**

Add to `src/action/guards.ts`:

```ts
import { loadConfig } from '../engine/config.ts';
import { manifestBumpViolations } from '../engine/deps.ts';
import { worktreeAt } from '../git.ts';

const MANIFESTS = ['package.json', 'pnpm-lock.yaml'];

/** Empty if no manifest/lockfile changed, or the change stays within §6.3 gates 1–4. */
export async function g2ManifestEnvelope(repo: string, base: string, head: string): Promise<string[]> {
  const touched = (await changedFiles(repo, base, head)).some((f) => MANIFESTS.includes(f));
  if (!touched) return [];

  const baseTree = await worktreeAt(repo, base);
  const headTree = await worktreeAt(repo, head);
  try {
    const cfg = await loadConfig(baseTree.dir); // policy read from BASE
    const basePkg = await readJson(`${baseTree.dir}/package.json`);
    const headPkg = await readJson(`${headTree.dir}/package.json`);
    return manifestBumpViolations(basePkg, headPkg, cfg.allowBumping ?? []);
  } finally {
    await baseTree.cleanup();
    await headTree.cleanup();
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/action/guards.test.ts`
Expected: PASS. Note: G2 confirms the manifest envelope (gates 1–4); the lockfile-honesty
gate (5) is delegated per spec §3.3 and surfaced via the approve warning (Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/action/guards.ts src/action/guards.test.ts
git commit -m "feat: add the g2 manifest-envelope guard"
```

---

### Task 6: Backstop confirmation

Confirm every `ci-checks` + `lockfile-honesty-checks` name is `success` on the head SHA
(spec §4.2, §7). Octokit, mocked in tests.

**Files:**
- Create: `src/action/backstop.ts`
- Test: `src/action/backstop.test.ts`

**Interfaces:**
- Produces: `confirmChecksGreen(octokit, { owner, repo, headSha, required }): Promise<{ ok: boolean; pending: string[]; failed: string[] }>`
  where `required: string[]`. Task 9 consumes it. `octokit` is `ReturnType<typeof getOctokit>`.

- [ ] **Step 1: Write the failing test**

Create `src/action/backstop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { confirmChecksGreen } from './backstop.ts';

function fakeOctokit(runs: Array<{ name: string; status: string; conclusion: string | null }>) {
  return {
    paginate: async () => runs,
    rest: { checks: { listForRef: {} } },
  } as never;
}

describe('confirmChecksGreen', () => {
  const args = { owner: 'o', repo: 'r', headSha: 'a'.repeat(40) };
  it('ok when all required checks are successful', async () => {
    const ok = await confirmChecksGreen(fakeOctokit([{ name: 'CI', status: 'completed', conclusion: 'success' }]), { ...args, required: ['CI'] });
    expect(ok).toEqual({ ok: true, pending: [], failed: [] });
  });
  it('not ok, pending, when a required check has not completed', async () => {
    const r = await confirmChecksGreen(fakeOctokit([{ name: 'CI', status: 'in_progress', conclusion: null }]), { ...args, required: ['CI'] });
    expect(r.ok).toBe(false); expect(r.pending).toEqual(['CI']);
  });
  it('not ok, failed, when a required check concluded non-success', async () => {
    const r = await confirmChecksGreen(fakeOctokit([{ name: 'CI', status: 'completed', conclusion: 'failure' }]), { ...args, required: ['CI'] });
    expect(r.ok).toBe(false); expect(r.failed).toEqual(['CI']);
  });
  it('not ok, pending, when a required check is entirely absent', async () => {
    const r = await confirmChecksGreen(fakeOctokit([]), { ...args, required: ['CI'] });
    expect(r.ok).toBe(false); expect(r.pending).toEqual(['CI']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/action/backstop.test.ts`
Expected: FAIL — `confirmChecksGreen` not defined.

- [ ] **Step 3: Implement it**

Create `src/action/backstop.ts`:

```ts
interface CheckRun { name: string; status: string; conclusion: string | null }

export async function confirmChecksGreen(
  octokit: { paginate: (route: unknown, params: unknown) => Promise<CheckRun[]> } & { rest: { checks: { listForRef: unknown } } },
  args: { owner: string; repo: string; headSha: string; required: readonly string[] },
): Promise<{ ok: boolean; pending: string[]; failed: string[] }> {
  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner: args.owner, repo: args.repo, ref: args.headSha, per_page: 100,
  });
  const latest = new Map<string, CheckRun>(); // newest run wins per name
  for (const run of runs) latest.set(run.name, run);

  const pending: string[] = [];
  const failed: string[] = [];
  for (const name of args.required) {
    const run = latest.get(name);
    if (!run || run.status !== 'completed') pending.push(name);
    else if (run.conclusion !== 'success') failed.push(name);
  }
  return { ok: pending.length === 0 && failed.length === 0, pending, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/action/backstop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/action/backstop.ts src/action/backstop.test.ts
git commit -m "feat: confirm backstop checks green on the head sha"
```

---

### Task 7: The verdict → review decision (pure §5 matrix)

The heart of the reviewer. A pure function over `(verdict, guardsPass, backstopGreen,
lockfileHonestyConfigured)`. No I/O, so every §5 row is unit-tested exhaustively.

**Files:**
- Create: `src/action/decide.ts`
- Test: `src/action/decide.test.ts`

**Interfaces:**
- Produces: `type Outcome = { action: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | 'NONE'; body: string }`
  and `decideReview(input): Outcome` where
  `input = { verdict: Verdict; guardsPass: boolean; backstopGreen: boolean; lockfileHonestyConfigured: boolean }`.
  Task 9 consumes it.

- [ ] **Step 1: Write the failing test (every §5 row)**

Create `src/action/decide.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideReview } from './decide.ts';

const base = { guardsPass: true, backstopGreen: true, lockfileHonestyConfigured: false };

describe('decideReview (§5 matrix)', () => {
  it('backstop not green → NONE (no-op), any verdict', () => {
    expect(decideReview({ ...base, verdict: 'APPROVE', backstopGreen: false }).action).toBe('NONE');
  });
  it('APPROVE + guards pass + green → APPROVE with lockfile warning (no honesty check)', () => {
    const o = decideReview({ ...base, verdict: 'APPROVE' });
    expect(o.action).toBe('APPROVE');
    expect(o.body).toContain('assumes the lockfile is honest');
  });
  it('APPROVE + honesty check configured → APPROVE without the warning', () => {
    const o = decideReview({ ...base, verdict: 'APPROVE', lockfileHonestyConfigured: true });
    expect(o.action).toBe('APPROVE');
    expect(o.body).not.toContain('assumes the lockfile is honest');
  });
  it('APPROVE + guards fail → REQUEST_CHANGES, no artifact content echoed', () => {
    const o = decideReview({ ...base, verdict: 'APPROVE', guardsPass: false });
    expect(o.action).toBe('REQUEST_CHANGES');
    expect(o.body).toContain('refuted');
  });
  it('COMMENT + guards pass → COMMENT (vouched subset)', () => {
    expect(decideReview({ ...base, verdict: 'COMMENT' }).action).toBe('COMMENT');
  });
  it('COMMENT + guards fail → COMMENT (generic, no subset)', () => {
    const o = decideReview({ ...base, verdict: 'COMMENT', guardsPass: false });
    expect(o.action).toBe('COMMENT');
    expect(o.body).toContain('could not verify');
  });
  it('REQUEST_CHANGES (honest invalid) → NONE, guards either way', () => {
    expect(decideReview({ ...base, verdict: 'REQUEST_CHANGES' }).action).toBe('NONE');
    expect(decideReview({ ...base, verdict: 'REQUEST_CHANGES', guardsPass: false }).action).toBe('NONE');
  });
  it('ABSTAIN → NONE', () => {
    expect(decideReview({ ...base, verdict: 'ABSTAIN' }).action).toBe('NONE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/action/decide.test.ts`
Expected: FAIL — `decideReview` not defined.

- [ ] **Step 3: Implement the matrix**

Create `src/action/decide.ts`:

```ts
import type { Verdict } from '../commands/report.ts';

export interface DecideInput {
  verdict: Verdict;
  guardsPass: boolean;
  backstopGreen: boolean;
  lockfileHonestyConfigured: boolean;
}
export interface Outcome {
  action: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | 'NONE';
  body: string;
}

const LOCKFILE_WARNING =
  '\n\n> ⚠️ waiver-stamp assumes the lockfile is honest; wire a lockfile-honesty check into ' +
  '`lockfile-honesty-checks` to remove this caveat.';

/** The spec §5 decision table. Pure — no I/O. */
export function decideReview(i: DecideInput): Outcome {
  // REQUEST_CHANGES / ABSTAIN never produce a review (the red check / absent claim cover them).
  if (i.verdict === 'REQUEST_CHANGES' || i.verdict === 'ABSTAIN') return { action: 'NONE', body: '' };

  // Guards failing while a positive claim stands is the only case guards change.
  if (!i.guardsPass) {
    if (i.verdict === 'APPROVE') {
      return { action: 'REQUEST_CHANGES', body: 'waiver-stamp: the trusted layer refuted this APPROVE claim (a `.github/**` or out-of-envelope manifest change). Full human review applies.' };
    }
    return { action: 'COMMENT', body: 'waiver-stamp: could not verify these results (workflow/manifest changes); full human review applies.' };
  }

  // Guards pass — but an APPROVE only removes review once the backstop is green.
  if (!i.backstopGreen) return { action: 'NONE', body: '' };

  if (i.verdict === 'APPROVE') {
    const warn = i.lockfileHonestyConfigured ? '' : LOCKFILE_WARNING;
    return { action: 'APPROVE', body: `waiver-stamp: every commit is mechanically stamped — this PR is fully accounted for.${warn}` };
  }
  return { action: 'COMMENT', body: 'waiver-stamp: some commits are mechanically stamped; the rest still need a human.' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/action/decide.test.ts`
Expected: PASS (all rows).

- [ ] **Step 5: Commit**

```bash
git add src/action/decide.ts src/action/decide.test.ts
git commit -m "feat: map the verdict to a review decision"
```

---

### Task 8: Post the outcome (review + sticky comment + self-heal)

Side effects: submit/dismiss reviews and maintain one sticky comment idempotently (spec §5,
§6). Octokit mocked.

**Files:**
- Create: `src/action/review.ts`
- Test: `src/action/review.test.ts`

**Interfaces:**
- Consumes: `Outcome` (Task 7).
- Produces: `postOutcome(octokit, { owner, repo, prNumber, headSha, outcome }): Promise<void>`
  — submits the review when `action !== 'NONE'`, sets `commit_id: headSha`, upserts the
  sticky comment, and dismisses its own prior `REQUEST_CHANGES` when the new outcome is not
  one. Task 9 consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/action/review.test.ts` (representative cases — mock the Octokit REST surface):

```ts
import { describe, expect, it, vi } from 'vitest';
import { postOutcome } from './review.ts';

function octokitSpy(existingReviews: Array<{ id: number; user: { login: string }; state: string }> = []) {
  const createReview = vi.fn(async () => ({}));
  const dismissReview = vi.fn(async () => ({}));
  return {
    createReview, dismissReview,
    octokit: {
      rest: {
        pulls: {
          listReviews: async () => ({ data: existingReviews }),
          createReview, dismissReview,
        },
        issues: { listComments: async () => ({ data: [] }), createComment: vi.fn(async () => ({})), updateComment: vi.fn() },
        users: { getAuthenticated: async () => ({ data: { login: 'github-actions[bot]' } }) },
      },
    } as never,
  };
}

const args = { owner: 'o', repo: 'r', prNumber: 7, headSha: 'a'.repeat(40) };

describe('postOutcome', () => {
  it('submits an APPROVE review bound to the head SHA', async () => {
    const s = octokitSpy();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.createReview).toHaveBeenCalledWith(expect.objectContaining({ event: 'APPROVE', commit_id: args.headSha }));
  });
  it('on a non-REQUEST_CHANGES outcome, dismisses its own prior REQUEST_CHANGES', async () => {
    const s = octokitSpy([{ id: 42, user: { login: 'github-actions[bot]' }, state: 'CHANGES_REQUESTED' }]);
    await postOutcome(s.octokit, { ...args, outcome: { action: 'APPROVE', body: 'ok' } });
    expect(s.dismissReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 42 }));
  });
  it('NONE submits no review', async () => {
    const s = octokitSpy();
    await postOutcome(s.octokit, { ...args, outcome: { action: 'NONE', body: '' } });
    expect(s.createReview).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/action/review.test.ts`
Expected: FAIL — `postOutcome` not defined.

- [ ] **Step 3: Implement it**

Create `src/action/review.ts`:

```ts
import type { Outcome } from './decide.ts';

type Octokit = ReturnType<typeof import('@actions/github').getOctokit>;

/** Submit the review (if any), bind it to headSha, upsert the sticky comment, self-heal. */
export async function postOutcome(
  octokit: Octokit,
  args: { owner: string; repo: string; prNumber: number; headSha: string; outcome: Outcome },
): Promise<void> {
  const { owner, repo, prNumber: pull_number, headSha, outcome } = args;
  const me = (await octokit.rest.users.getAuthenticated()).data.login;

  // Self-heal: clear our own stale CHANGES_REQUESTED unless we're posting a new one.
  if (outcome.action !== 'REQUEST_CHANGES') {
    const reviews = (await octokit.rest.pulls.listReviews({ owner, repo, pull_number })).data;
    for (const r of reviews) {
      if (r.user?.login === me && r.state === 'CHANGES_REQUESTED') {
        await octokit.rest.pulls.dismissReview({ owner, repo, pull_number, review_id: r.id, message: 'superseded — re-verified' });
      }
    }
  }

  if (outcome.action !== 'NONE') {
    await octokit.rest.pulls.createReview({
      owner, repo, pull_number, commit_id: headSha, event: outcome.action, body: outcome.body,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/action/review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/action/review.ts src/action/review.test.ts
git commit -m "feat: post the review outcome with self-heal"
```

---

### Task 9: Orchestrate `run()` (fail-closed)

Wire it all together on the `workflow_run` event: resolve PR + head, confirm backstop, locate
+ validate the artifact, run guards, decide, post. Any error → neutral, never a verdict.

**Files:**
- Modify: `src/action/main.ts`
- Create: `src/action/inputs.ts` (parse `ci-checks`/`lockfile-honesty-checks`)
- Test: `src/action/main.test.ts`, `src/action/inputs.test.ts`

**Interfaces:**
- Consumes: all Task 3–8 exports; `@actions/github` `context`, `getOctokit`.
- Produces: the terminal `run()` behavior; `parseList(raw: string): string[]`.

- [ ] **Step 1: Write the failing test for `parseList`**

Create `src/action/inputs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseList } from './inputs.ts';

describe('parseList', () => {
  it('splits on commas and newlines, trims, drops empties', () => {
    expect(parseList(' CI, lint \n build \n')).toEqual(['CI', 'lint', 'build']);
  });
  it('empty string → empty list', () => {
    expect(parseList('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run + implement `parseList`**

Run: `pnpm test -- src/action/inputs.test.ts` (FAIL), then create `src/action/inputs.ts`:

```ts
/** Split a comma/newline-separated action input into a trimmed, non-empty list. */
export function parseList(raw: string): string[] {
  return raw.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length > 0);
}
```

Run again: PASS.

- [ ] **Step 3: Write the orchestration test**

Create `src/action/main.test.ts`. Mock `@actions/github` `context` (a `workflow_run` payload)
and a fake Octokit; stub the module's collaborators via a thin injectable seam. Cover:
(a) no open PR → no-op; (b) backstop not green → no-op; (c) happy APPROVE → `postOutcome`
called with an APPROVE outcome; (d) a thrown collaborator → neutral (no review, `setFailed`
NOT called with a verdict). Use `run({ deps })` dependency injection so the test supplies
fakes:

```ts
import { describe, expect, it, vi } from 'vitest';
import { run } from './main.ts';

const baseDeps = {
  context: { payload: { workflow_run: { head_sha: 'a'.repeat(40), head_branch: 'feat', repository: { owner: { login: 'o' }, name: 'r' } } } },
  getOctokit: () => ({ /* fake rest surface */ }) as never,
  resolvePr: vi.fn(async () => ({ number: 7, base: 'b'.repeat(40) })),
  confirmChecksGreen: vi.fn(async () => ({ ok: true, pending: [], failed: [] })),
  fetchArtifact: vi.fn(async () => ({ verdict: 'APPROVE', base: 'b'.repeat(40), head: 'a'.repeat(40), toolVersion: '1', commits: [] })),
  g1: vi.fn(async () => []),
  g2: vi.fn(async () => []),
  postOutcome: vi.fn(async () => {}),
  inputs: { ciChecks: ['CI'], lockfileHonestyChecks: [] as string[] },
};

describe('run', () => {
  it('no open PR → no-op', async () => {
    const deps = { ...baseDeps, resolvePr: vi.fn(async () => null) };
    await run(deps as never);
    expect(deps.postOutcome).not.toHaveBeenCalled();
  });
  it('happy path posts an APPROVE outcome', async () => {
    const deps = { ...baseDeps, postOutcome: vi.fn(async () => {}) };
    await run(deps as never);
    expect(deps.postOutcome).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: expect.objectContaining({ action: 'APPROVE' }) }));
  });
  it('a collaborator error is fail-closed (no review posted)', async () => {
    const deps = { ...baseDeps, fetchArtifact: vi.fn(async () => { throw new Error('boom'); }), postOutcome: vi.fn(async () => {}) };
    await run(deps as never);
    expect(deps.postOutcome).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- src/action/main.test.ts`
Expected: FAIL — `run` does not accept deps / not wired.

- [ ] **Step 5: Implement the orchestrator**

Rewrite `src/action/main.ts` with an injectable `run(deps)` (the real `deps` are assembled in
the `if (!VITEST)` block from `@actions/github` + Task 3–8 functions + a `resolvePr` and
`fetchArtifact` helper that use Octokit's `pulls.list`/`actions.listWorkflowRunArtifacts` +
`downloadArtifact`). Shape:

```ts
import * as core from '@actions/core';

export interface RunDeps {
  context: { payload: { workflow_run: { head_sha: string; head_branch: string; repository: { owner: { login: string }; name: string } } } };
  getOctokit: () => never;
  resolvePr: (o: string, r: string, headSha: string) => Promise<{ number: number; base: string } | null>;
  confirmChecksGreen: (ok: never, a: unknown) => Promise<{ ok: boolean; pending: string[]; failed: string[] }>;
  fetchArtifact: (ok: never, o: string, r: string, headSha: string) => Promise<import('./schema.ts').ArtifactReport | null>;
  g1: (repo: string, base: string, head: string) => Promise<string[]>;
  g2: (repo: string, base: string, head: string) => Promise<string[]>;
  postOutcome: (ok: never, a: unknown) => Promise<void>;
  inputs: { ciChecks: string[]; lockfileHonestyChecks: string[] };
  repoDir?: string;
}

export async function run(deps: RunDeps): Promise<void> {
  try {
    const wr = deps.context.payload.workflow_run;
    const owner = wr.repository.owner.login;
    const repo = wr.repository.name;
    const headSha = wr.head_sha;
    const ok = deps.getOctokit();

    const pr = await deps.resolvePr(owner, repo, headSha);
    if (!pr) return core.info('no open PR for head SHA — nothing to do');

    const required = [...deps.inputs.ciChecks, ...deps.inputs.lockfileHonestyChecks];
    const backstop = await deps.confirmChecksGreen(ok, { owner, repo, headSha, required });
    if (!backstop.ok) return core.info(`backstop not green (pending=${backstop.pending}, failed=${backstop.failed}) — no-op`);

    const artifact = await deps.fetchArtifact(ok, owner, repo, headSha);
    if (!artifact || artifact.head !== headSha) return core.info('artifact missing or head mismatch — fail-closed');

    const dir = deps.repoDir ?? process.cwd();
    const guardsPass = (await deps.g1(dir, artifact.base, headSha)).length === 0
      && (await deps.g2(dir, artifact.base, headSha)).length === 0;

    const { decideReview } = await import('./decide.ts');
    const outcome = decideReview({
      verdict: artifact.verdict,
      guardsPass,
      backstopGreen: true,
      lockfileHonestyConfigured: deps.inputs.lockfileHonestyChecks.length > 0,
    });
    await deps.postOutcome(ok, { owner, repo, prNumber: pr.number, headSha, outcome });
  } catch (err) {
    // Fail-closed: log, never post a verdict, never crash the workflow into a red required check.
    core.warning(`waiver-stamp-review errored, no review posted: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

The non-test entry assembles real deps (checkout dir = `process.cwd()`; the caller workflow
checks out the head SHA with `fetch-depth: 0`).

- [ ] **Step 6: Run the full action test suite + build**

Run: `pnpm test -- src/action && pnpm build:action && pnpm typecheck && pnpm lint`
Expected: PASS; bundle rebuilt (drift-guard green).

- [ ] **Step 7: Commit**

```bash
git add src/action/main.ts src/action/inputs.ts src/action/inputs.test.ts \
  src/action/main.test.ts .github/actions/waiver-stamp-review/dist/index.js
git commit -m "feat: orchestrate the reviewer, fail-closed"
```

---

### Task 10: Open PR 2

- [ ] **Step 1: Create the branch** (use the `git-branch` skill; off `main`, no ticket) →
  `jsalvata/automation-reviewer`. Cherry-pick/rebase the Task 1–9 commits onto it.
- [ ] **Step 2: Verify green:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build:action`.
- [ ] **Step 3: Open the PR** (use the `git-pull-request` skill). Body states: this is PR 2
  of the automation-layer stack; it ships the reviewer action + unit tests; the wiring that
  makes it live is the stacked PR 3; not yet wired into this repo's CI. Test plan: the
  `src/action/*.test.ts` suites + the bundle drift-guard.

---

# PR 3 — Wiring, adoption & dogfood

### Task 11: The composite `waiver-stamp` producer action

**Files:**
- Create: `.github/actions/waiver-stamp/action.yml`

**Interfaces:**
- Produces: a check named `waiver-stamp` and an artifact `waiver-stamp-report` containing
  `{ ...VerifyReport, toolVersion }`.

- [ ] **Step 1: Write the action**

Create `.github/actions/waiver-stamp/action.yml`:

```yaml
name: waiver-stamp
description: Run waiver stamp over the PR range, publish a report artifact, and gate on the verdict.
inputs:
  waiver-version:
    description: Version of the waiver-stamp CLI to run.
    required: false
    default: latest
runs:
  using: composite
  steps:
    - id: stamp
      shell: bash
      run: |
        set -euo pipefail
        BASE="${{ github.event.pull_request.base.sha }}"
        HEAD="${{ github.event.pull_request.head.sha }}"
        VER="$(npx --yes waiver-stamp@${{ inputs.waiver-version }} --version)"
        set +e
        npx --yes waiver-stamp@${{ inputs.waiver-version }} stamp --base "$BASE" --head "$HEAD" --json > report.raw.json
        CODE=$?
        set -e
        # Wrap with toolVersion; the report already carries verdict/base/head (Task 1).
        node -e "const r=require('./report.raw.json');process.stdout.write(JSON.stringify({...r,toolVersion:'$VER'}))" > waiver-stamp-report.json
        {
          echo "### waiver-stamp"
          node -e "const r=require('./waiver-stamp-report.json');console.log('Verdict: **'+r.verdict+'**  (',r.commits.length,'commits )')"
        } >> "$GITHUB_STEP_SUMMARY"
        echo "verdict=$(node -e "process.stdout.write(require('./waiver-stamp-report.json').verdict)")" >> "$GITHUB_OUTPUT"
    - if: always()
      uses: actions/upload-artifact@v4
      with:
        name: waiver-stamp-report
        path: waiver-stamp-report.json
        retention-days: 3
    - if: steps.stamp.outputs.verdict == 'REQUEST_CHANGES'
      shell: bash
      run: 'echo "waiver claim failed — see the job summary"; exit 1'
```

Note: the artifact upload is `if: always()` (spec §4.1) so an honest `invalid` still ships
its artifact before the failing conclusion.

- [ ] **Step 2: Lint the workflow YAML** (deferred to Task 14's actionlint job; syntax-check
  now with `python -c 'import yaml,sys;yaml.safe_load(open(".github/actions/waiver-stamp/action.yml"))'`).

- [ ] **Step 3: Commit**

```bash
git add .github/actions/waiver-stamp/action.yml
git commit -m "feat: add the waiver-stamp producer action"
```

---

### Task 12: Dogfood config `.waiver-stamp.json`

**Files:**
- Create: `.waiver-stamp.json`

- [ ] **Step 1: Write the config**

Create `.waiver-stamp.json` (a real, reviewed policy for this repo):

```json
{
  "allowBumping": [],
  "changeDocs": {
    "allow": ["docs/**", "**/README.md", "CHANGELOG.md"],
    "deny": [".claude/**", "**/CLAUDE.md", "**/AGENTS.md"]
  }
}
```

`allowBumping` stays empty (this repo has no lockfile-honesty check yet, spec §3.3);
`changeDocs` mirrors the spec §6.5 example.

- [ ] **Step 2: Verify it loads**

Run: `pnpm dev verify HEAD` (or a small `loadConfig('.')` smoke) — expect no
`WaiverConfigError`.

- [ ] **Step 3: Commit**

```bash
git add .waiver-stamp.json
git commit -m "feat: add dogfood .waiver-stamp.json"
```

---

### Task 13: Wire this repo's CI + the reviewer caller

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/waiver-stamp-review.yml`

- [ ] **Step 1: Add the producer job to CI**

Append a job to `.github/workflows/ci.yml` that runs on `pull_request`, checks out with
`fetch-depth: 0`, installs deps, then `uses: ./.github/actions/waiver-stamp`. The job's name
becomes the `waiver-stamp` check.

```yaml
  waiver-stamp:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: ./.github/actions/waiver-stamp
```

- [ ] **Step 2: Add the reviewer caller**

Create `.github/workflows/waiver-stamp-review.yml`:

```yaml
name: waiver-stamp-review
on:
  workflow_run:
    workflows: [CI]           # every backstop-producing workflow (here: CI carries build + waiver-stamp)
    types: [completed]
permissions:
  pull-requests: write
  checks: read
  contents: read
  actions: read
jobs:
  review:
    runs-on: ubuntu-latest
    concurrency:
      group: waiver-stamp-review-${{ github.event.workflow_run.head_branch }}
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
        with: { ref: ${{ github.event.workflow_run.head_sha }}, fetch-depth: 0, persist-credentials: false }
      - uses: ./.github/actions/waiver-stamp-review
        with:
          ci-checks: |
            build
            waiver-stamp
          lockfile-honesty-checks: ''
```

- [ ] **Step 3: Syntax-check both** (actionlint runs in Task 14).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/waiver-stamp-review.yml
git commit -m "feat: wire waiver-stamp into this repo's ci"
```

---

### Task 14: Workflow security lint (`zizmor` + `actionlint`)

**Files:**
- Create: `.github/workflows/actionlint.yml`

- [ ] **Step 1: Add the lint workflow**

Create `.github/workflows/actionlint.yml`:

```yaml
name: workflow-lint
on:
  pull_request:
    paths: ['.github/**']
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: actionlint
        uses: raven-actions/actionlint@v2
      - name: zizmor
        uses: zizmorcore/zizmor-action@v0
```

- [ ] **Step 2: Run actionlint locally if available** (`actionlint` binary) over `.github/`;
  fix any findings (quote expansions, pin actions). Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/actionlint.yml
git commit -m "feat: lint workflows with actionlint and zizmor"
```

---

### Task 15: Adoption guide, templates & README §20

**Files:**
- Create: `docs/adoption.md`
- Create: `examples/waiver-stamp-ci.yml`, `examples/waiver-stamp-review.yml`
- Modify: `README.md`

- [ ] **Step 1: Write the two templates** — copy the Task 11/13 caller YAML into `examples/`,
  parameterized with `jsalvata/waiver-stamp/.github/actions/...@<full-SHA>` `uses:` refs and
  comments marking what the adopter edits (`ci-checks`, the workflow name).

- [ ] **Step 2: Write `docs/adoption.md`** — the spec §8 adopter checklist verbatim (8 steps:
  add the `waiver-stamp` CI step; add the reviewer caller; mark both checks required + enable
  dismiss-stale; merge/rebase not squash; `commitlint body-max-line-length: [0]`; optional
  `.github/**` protection; optional App-token upgrade; optional `allowBumping` caveat).

- [ ] **Step 3: Wire README §20 step 4** — add a short "Install the automation layer" block
  pointing at `docs/adoption.md` and the `examples/` templates.

- [ ] **Step 4: Commit**

```bash
git add docs/adoption.md examples/ README.md
git commit -m "docs: add automation-layer adoption guide and templates"
```

---

### Task 16: Real-PR e2e acceptance harness

Drives the deployed workflow against real PRs (spec §10). Because `workflow_run`/`pull_request`
run the **default-branch** workflow definition, full e2e is a **post-merge** acceptance step;
the harness is committed now and documented as such.

**Files:**
- Create: `bench/e2e/run.ts`, `bench/e2e/README.md`, `bench/e2e/fixtures/*`

- [ ] **Step 1: Write the fixtures** — four PR seed scripts + one forgery:
  **approve** (a waivered pure rename), **comment** (one stamped + one unwaivered commit),
  **request-changes** (a present-but-failing waiver), **abstain** (no waiver block),
  **g1-forgery** (a stamped rename + a `.github/**` edit → must NOT approve).

- [ ] **Step 2: Write `bench/e2e/run.ts`** — a `gh`-driven script that, for each fixture,
  creates a branch + PR against a sandbox base in this repo, waits for the `waiver-stamp-review`
  run, and asserts the posted review (`gh pr view --json reviews`) matches the expected action.

- [ ] **Step 3: Document** in `bench/e2e/README.md` that this runs post-merge (the workflow
  must be on the default branch) and how to run it (`tsx bench/e2e/run.ts`), listing the five
  expected outcomes.

- [ ] **Step 4: Commit**

```bash
git add bench/e2e
git commit -m "test: add real-pr e2e acceptance harness"
```

---

### Task 17: Open PR 3 + Cleanup verdict

- [ ] **Step 1: Create the branch** (`git-branch` skill; off the PR 2 branch) →
  `jsalvata/automation-wiring`. Rebase Task 11–16 commits onto it.
- [ ] **Step 2: Verify green:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build:action`;
  actionlint clean.
- [ ] **Step 3: Open the PR** (`git-pull-request` skill). Body: PR 3 of the stack, depends on
  PR 2's `waiver-stamp-review` action; wires the producer + reviewer into this repo, adds
  adoption docs/templates, dogfoods with `.waiver-stamp.json`, and adds the e2e harness. Test
  plan: CI green; the `waiver-stamp` check appears on the PR; after merge, run
  `bench/e2e/run.ts` and confirm the five outcomes.
- [ ] **Step 4: Post-merge acceptance** — once PR 3 is on `main`, run the e2e harness; record
  the five outcomes in the PR.

**Cleanup verdict (PR 4):** evaluate after PR 3. Expected **skip** — the feature is
greenfield and leaves no dead branches, no duplication (the composite action wraps
`stamp --json` rather than re-implementing it), and no now-clearer names. If the post-merge
e2e reveals the composite action's `node -e` JSON-wrap is fragile, promote "have `stamp --json`
emit `toolVersion` natively" to a small follow-up refactor — that is the one candidate, and
only if observed. State the skip (or that one follow-up) explicitly in the PR 3 description.

---

## Self-Review

**Spec coverage** (design doc §-by-§): §2 two-layer split → Tasks 2/11/13; §3 G1/G2 →
Tasks 4/5; §3.3 lockfile honesty → Task 7 warning + Task 12 empty `allowBumping`; §4.1
producer/artifact → Tasks 11/1; §4.2 reviewer trigger/inputs/behaviour → Tasks 2/9/13; §4.3
artifact contract → Tasks 1/3; §5 decision table → Task 7 (+ §6 self-heal → Task 8); §6
idempotency/concurrency → Task 13 caller; §7 config surface → Tasks 2/7; §8 adoption → Task
15; §9 dogfood → Tasks 12/13; §10 testing → per-task units + Task 16 e2e + Task 14 lint; §11
decisions realized in structure. No gaps.

**Placeholder scan:** no "TBD"/"add appropriate X"; every code step carries real code, every
YAML/JSON step real content. (Task 16 fixtures describe exact scenarios; their seed scripts
are the deliverable of that task's steps.)

**Type consistency:** `VerifyReport.base/head` (Task 1) ↔ `ArtifactReportSchema` (Task 3) ↔
`run()` head cross-check (Task 9); `Outcome`/`decideReview` (Task 7) ↔ `postOutcome` (Task 8)
↔ `run()` (Task 9); `confirmChecksGreen` return shape (Task 6) ↔ `run()` (Task 9); guard
signatures `(repo, base, head) → string[]` (Tasks 4/5) ↔ `run()` (Task 9). Consistent.
