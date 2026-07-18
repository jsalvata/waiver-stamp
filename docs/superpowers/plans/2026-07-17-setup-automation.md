# Setup-automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `waiver-stamp` adoption from the ~9-step `docs/auto-approval-setup.md` chore into "run one command, click twice," per the merged spec [`docs/design/setup-automation.md`](../../design/setup-automation.md).

**Architecture:** Three components on top of the unchanged stamping engine. **A** — reusable `workflow_call` workflows in this repo that adopters call in a few lines, with the reviewer's required-check set **auto-discovered** from branch protection instead of hand-listed. **B** — a per-adopter GitHub App provisioned through the App-Manifest handshake captured on a loopback HTTP server (no shared secret, no backend). **C** — a `waiver setup-repository` CLI that validates prerequisites, drives B, provisions secrets, adds a dedicated branch-protection ruleset, and drops the caller workflows non-destructively. The trust model is unchanged: the reviewer still runs this repo's pinned default-branch code with the adopter's token, fail-closed everywhere.

**Tech Stack:** TypeScript (ESM, `.ts` extensions in imports, Node ≥24), commander CLI, zod v4 (`zod/v4`) schemas, vitest (`vitest run`), Biome lint/format, `@actions/core`/`@actions/github` (Octokit) in the action, `gh` CLI shelled out for repo administration, Node `node:http`/`node:net` for the loopback server.

## Global Constraints

- **Node** `>=24` (`package.json` engines); **packageManager** `pnpm@9.12.0`.
- **Module system:** ESM. Relative imports carry the `.ts` extension (e.g. `import { x } from './y.ts'`). `type: module`.
- **Schemas:** zod imported from `zod/v4` (the v4 bridge), matching `src/engine/config.ts`.
- **Lint/format:** Biome, single quotes, semicolons always, trailing commas all, 100-col width, 2-space indent. Run `pnpm lint` and `pnpm format`.
- **Tests:** vitest. `pnpm test` runs `vitest run`. Test files are `*.test.ts` beside the source. `process.env.VITEST` guards the action's ncc entry (`main.ts:105`).
- **Exit codes** (`src/commands/report.ts` `EXIT`): `0` STAMPED/success, `1` FAILURE (verdict-only — setup never emits it), `2` MALFORMED/failed-preflight, `3` INTERNAL. Setup uses `0`/`2`/`3` only (spec §4.12).
- **Trust invariant:** no change weakens the reviewer. Reviewer runs this repo's pinned default-branch code with the adopter's token; every ambiguity is a fail-closed no-op, never a silent approve (spec §1, §5).
- **Non-destructive:** `setup-repository` runs against an already-operational repo. Never overwrite an existing workflow, never edit existing branch-protection rules (add a *dedicated* ruleset), never touch a `.waiver-stamp.json` that already exists. Every mutating step checks current state first and converges on re-run (spec §1, §4).
- **Self-exclusion constant:** the reviewer's own check-run name is `waiver-stamp` (this repo's producer job id → check-run name). It must never be in the backstop set (spec §2.4).
- **Pins:** the reusable workflows and actions are pinned at `@vX` immutable tags; the current release is `v1.16.0` (`package.json` version `1.16.0`). Bump the pin string wherever it appears when a new tag ships.
- **Commits/branches/PRs:** governed by the `git-commit`, `git-branch`, and `git-pull-request` skills (GitHub username `jsalvata`). Commit commands shown below are indicative — construct the real messages via the skill. No draft PRs (open ready-for-review). No commit/push bearing a Mon–Fri 09:00–18:00 (+0200) timestamp.

---

## PR Plan

Reasoning order: feature spike → prep → cleanup. Ship order: 0 → 1..N → N+1. (Mirrors spec §8.)

- **PR 0 — Prep refactor** (`prep-check-resolution` off `main`): extract the reviewer's inline backstop-set + honesty-flag computation (`main.ts:62`, `main.ts:93`) behind a `resolveRequiredChecks` seam that today returns the static inputs. Behavior-preserving, full suite green before/after.
  Removes friction: *"the backstop set and honesty flag are computed inline from inputs, so autodiscovery can't be slotted in without editing `run()`."*
- **PRs 1..N — Feature:**
  - **PR 1 — Autodiscovery** (`setup-automation-1` off prep): implement the seam against the rules endpoint (App token), self-exclude `waiver-stamp`, read the honesty-check name from a new `.waiver-stamp.json` field, keep the empty `ci-checks` override, remove `lockfile-honesty-checks`.
  - **PR 2 — Reusable workflows** (`setup-automation-2` off PR 1): add `.github/workflows/ci.yml` and `review.yml` (`workflow_call`) wrapping the existing actions; multi-workflow trigger; dogfood this repo onto its own callers; update `examples/` and `docs/auto-approval-setup.md`.
  - **PR 3 — App manifest + loopback core** (`setup-automation-3` off PR 2): manifest builder, loopback server (form page, callback capture, conversion), browser open. Unit-tested against a fake GitHub; no secrets written yet.
  - **PR 4 — `waiver setup-repository` orchestration** (`setup-automation-4` off PR 3): preflight, target prompt, App reuse/disk/fresh resolution, secret provisioning, additive ruleset, commitlint detection, non-destructive workflow drop, install hand-off, instructions page, `.waiver-stamp.json` seeding. Wired into `cli.ts`. Heaviest PR — split at the provisioning/repo-config seam if it crosses ~1000 lines.
- **PR N+1 — Cleanup refactor** (`cleanup-setup-automation` off PR 4): remove the now-dead `lockfile-honesty-checks` plumbing and manual-`ci-checks`-list narration from docs/examples/action inputs. Pure removal, suite green before/after.

Candidate prep for next time: if a future op needs more repo-config reads, the `gh`-shelling in PR 4 will want a typed wrapper — note it, don't build it speculatively now.

**Build-time verification (spec §7):** PR 1 depends on **V1** (does `GET /rules/branches/{branch}` need `administration:read`, or does `contents:read` suffice?). PR 3 depends on **V3** (localhost redirect accepted). PR 4 depends on **V4** (org-secret resolution through `create-github-app-token`) and **V5** (`secrets: inherit` carries App scopes). Resolve each at the top of its PR; where the answer differs from the spec's conservative assumption, adjust that PR's tasks and note it in the PR body.

---

## PR 0 — Prep refactor: extract `resolveRequiredChecks`

**Intent:** move the two inline computations at `main.ts:62` (`required = [...ciChecks, ...lockfileHonestyChecks]`) and `main.ts:93` (`lockfileHonestyConfigured: …length > 0`) behind one injected collaborator, so PR 1 can replace *how* the set is resolved without touching `run()`'s orchestration or the guards. **Pure refactor — no behavior change, no new test behavior.** The new collaborator's PR-0 body returns exactly what the inline code returned.

**Files:**
- Create: `src/action/resolve-checks.ts`
- Create: `src/action/resolve-checks.test.ts`
- Modify: `src/action/main.ts` (add `resolveRequiredChecks` to `RunDeps`, call it, drop the two inline computations and the now-unused `inputs` field from `RunDeps`)
- Modify: `src/action/main.test.ts` (provide the new collaborator in `baseDeps`; drop `inputs`)

**Interfaces:**
- Produces: `interface ResolvedChecks { required: string[]; lockfileHonestyConfigured: boolean }`
- Produces: `makeResolveRequiredChecks(inputs: { ciChecks: string[]; lockfileHonestyChecks: string[] }): (octokit: Octokit, args: { owner: string; repo: string; base: string; repoDir: string }) => Promise<ResolvedChecks>` — a factory mirroring `adapters.ts:makeResolvePr`. PR 0 body ignores `octokit`/`args`; PR 1 fills them in.
- Consumes (in `main.ts`): the factory is wired in the ncc entry from the parsed inputs; `run()` calls `deps.resolveRequiredChecks(octokit, { owner, repo, base: pr.base, repoDir: dir })`.

- [ ] **Step 1: Write the failing test for the extracted resolver**

Create `src/action/resolve-checks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeResolveRequiredChecks } from './resolve-checks.ts';

const octokit = {} as never;
const args = { owner: 'o', repo: 'r', base: 'b'.repeat(40), repoDir: '/tmp/x' };

describe('makeResolveRequiredChecks (static inputs — PR 0 behavior)', () => {
  it('unions ciChecks and lockfileHonestyChecks into the required set', async () => {
    const resolve = makeResolveRequiredChecks({ ciChecks: ['CI'], lockfileHonestyChecks: ['assay'] });
    const r = await resolve(octokit, args);
    expect(r.required).toEqual(['CI', 'assay']);
  });
  it('lockfileHonestyConfigured is true iff the honesty list is non-empty', async () => {
    const on = await makeResolveRequiredChecks({ ciChecks: ['CI'], lockfileHonestyChecks: ['assay'] })(octokit, args);
    const off = await makeResolveRequiredChecks({ ciChecks: ['CI'], lockfileHonestyChecks: [] })(octokit, args);
    expect(on.lockfileHonestyConfigured).toBe(true);
    expect(off.lockfileHonestyConfigured).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test resolve-checks`
Expected: FAIL — `Cannot find module './resolve-checks.ts'`.

- [ ] **Step 3: Write the resolver (static-inputs body)**

Create `src/action/resolve-checks.ts`:

```ts
import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

/** What the reviewer needs to run the backstop and decide the honesty caveat. */
export interface ResolvedChecks {
  /** Check-run names that must be green on the head SHA (waiver-stamp self-excluded). */
  required: string[];
  /** Whether a required lockfile-honesty check is present (silences the APPROVE caveat). */
  lockfileHonestyConfigured: boolean;
}

/**
 * Resolve the reviewer's required-check set and honesty flag. The factory closes over the
 * action inputs; the returned function takes the per-run context (PR 1 reads required-check
 * config from `octokit`/`args`; this PR-0 body returns the static inputs unchanged).
 */
export function makeResolveRequiredChecks(inputs: {
  ciChecks: string[];
  lockfileHonestyChecks: string[];
}) {
  return async (
    _octokit: Octokit,
    _args: { owner: string; repo: string; base: string; repoDir: string },
  ): Promise<ResolvedChecks> => ({
    required: [...inputs.ciChecks, ...inputs.lockfileHonestyChecks],
    lockfileHonestyConfigured: inputs.lockfileHonestyChecks.length > 0,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test resolve-checks`
Expected: PASS (both cases).

- [ ] **Step 5: Wire the seam into `RunDeps` and `run()`**

In `src/action/main.ts`: import the type and factory, add the collaborator to `RunDeps`, remove the `inputs` field, and replace the two inline computations. Concretely:

Replace the import block top (add):

```ts
import { makeResolveRequiredChecks, type ResolvedChecks } from './resolve-checks.ts';
```

In `RunDeps`, remove `inputs: { ciChecks: string[]; lockfileHonestyChecks: string[] };` and add:

```ts
  resolveRequiredChecks: (
    octokit: Octokit,
    args: { owner: string; repo: string; base: string; repoDir: string },
  ) => Promise<ResolvedChecks>;
```

In `run()`, move the `dir` computation above the backstop call and replace lines 62–63 and the `lockfileHonestyConfigured` argument. The body becomes:

```ts
    const pr = await deps.resolvePr(owner, repo, headSha);
    if (!pr) return core.info('no open PR for head SHA — nothing to do');

    const dir = deps.repoDir ?? process.cwd();
    const { required, lockfileHonestyConfigured } = await deps.resolveRequiredChecks(octokit, {
      owner,
      repo,
      base: pr.base,
      repoDir: dir,
    });
    const backstop = await deps.confirmChecksGreen(octokit, { owner, repo, headSha, required });
    if (!backstop.ok)
      return core.info(
        `backstop not green (pending=${backstop.pending}, failed=${backstop.failed}) — no-op`,
      );
```

Delete the later `const dir = deps.repoDir ?? process.cwd();` (now moved up) and change the `decideReview` call's honesty argument to the resolved value:

```ts
    const outcome = decideReview({
      verdict: artifact.verdict,
      guardsPass,
      backstopGreen: true,
      lockfileHonestyConfigured,
    });
```

In the ncc entry (`process.env.VITEST === undefined` block), remove `inputs` from the `run({...})` call and wire the factory instead:

```ts
  run({
    context: context as unknown as RunDeps['context'],
    getOctokit: () => octokit,
    resolvePr: makeResolvePr(octokit),
    confirmChecksGreen,
    fetchArtifact,
    g1: g1WorkflowIntegrity,
    g2: g2DependencyIntegrity,
    postOutcome,
    resolveRequiredChecks: makeResolveRequiredChecks(inputs),
  }).catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
```

(`inputs` stays defined locally in the ncc entry — `parseList('ci-checks')` / `parseList('lockfile-honesty-checks')` — it is now consumed by the factory rather than passed as a dep.)

- [ ] **Step 6: Update `main.test.ts` `baseDeps` to provide the collaborator**

In `src/action/main.test.ts`, remove `inputs: { ciChecks: ['CI'], lockfileHonestyChecks: [] as string[] },` from `baseDeps` and add:

```ts
  resolveRequiredChecks: vi.fn(async () => ({ required: ['CI'], lockfileHonestyConfigured: false })),
```

No assertion changes — every existing case (`no open PR`, `backstop not green`, `happy path APPROVE`, fail-closed, SHA mismatch, forged base, guards-with-pr.base, guard-offender logging) must still pass unchanged. The `backstop not green` case still drives `confirmChecksGreen` → `ok: false`; the happy path still reaches APPROVE with `lockfileHonestyConfigured: false` (the warning is present, as before).

- [ ] **Step 7: Run the full suite + lint + typecheck (green before/after is the refactor gate)**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS. If Biome flags the `_octokit`/`_args` params, confirm they are underscore-prefixed (recommended rules do not flag underscore-prefixed unused params; do not add a rule).

- [ ] **Step 8: Rebuild the action bundle (the refactor touched `main.ts`)**

Run: `pnpm build:action`
Expected: writes `.github/actions/waiver-stamp-review/dist`. Stage the regenerated `dist/index.js`.

- [ ] **Step 9: Commit (via git-commit skill)**

Indicative:

```bash
git add src/action/resolve-checks.ts src/action/resolve-checks.test.ts src/action/main.ts src/action/main.test.ts .github/actions/waiver-stamp-review/dist
# git-commit skill → e.g. "refactor: extract resolveRequiredChecks seam in the reviewer"
```

- [ ] **Step 10: Branch + PR (via git-branch / git-pull-request skills)**

Branch `jordi/setup-automation/prep-check-resolution` off up-to-date `main`. PR body: states this is PR 0 of the stack, a pure behavior-preserving prep refactor enabling autodiscovery (PR 1), suite green before and after.

---

## PR 1 — Check autodiscovery

**Intent:** replace the PR-0 static-inputs body of `makeResolveRequiredChecks` with real discovery — read required checks from the base branch's protection, self-exclude `waiver-stamp`, and read the honesty-check name from a new optional `.waiver-stamp.json` field. Keep `ci-checks` as an empty-by-default override; remove the `lockfile-honesty-checks` input. Discovery runs under whatever token the action is given — in the setup-produced config that is the App token carrying `administration:read` (spec §2.6).

**Verify first (V1):** confirm whether `GET /repos/{owner}/{repo}/rules/branches/{branch}` returns `required_status_checks` contexts to a `contents:read`-only token on a private repo, or requires `administration:read`. If `contents:read` suffices, note it in the PR body (the App can later drop the admin scope in PR 3 — but keep the scope this PR; changing it is PR 3's manifest). The discovery code is identical either way.

**Files:**
- Create: `src/action/discover-checks.ts` (the rules/classic reads)
- Create: `src/action/discover-checks.test.ts`
- Modify: `src/action/resolve-checks.ts` (real body; add self-exclusion + base-config read)
- Modify: `src/action/resolve-checks.test.ts` (discovery-driven cases)
- Modify: `src/engine/config.ts` (add optional `lockfileHonestyCheck` field to `ConfigSchema`)
- Modify: `src/engine/config.test.ts` (parse case for the new field)
- Modify: `schema/waiver-stamp-config.v0.schema.json` (regenerated by `pnpm gen:schema`)
- Modify: `.github/actions/waiver-stamp-review/action.yml` (remove `lockfile-honesty-checks` input)
- Modify: `.github/actions/waiver-stamp-review/dist` (rebuilt)

**Interfaces:**
- Produces: `discoverRequiredChecks(octokit, owner, repo, base): Promise<string[]>` — rules endpoint first, classic protection fallback, `[]` if neither yields checks.
- Produces: new optional config field `lockfileHonestyCheck?: string` on `WaiverConfig`.
- Consumes: `fileAtRef` + `parseConfig` from `src/git.ts` / `src/engine/config.ts` (same base-config read `guards.ts:65` uses).

- [ ] **Step 1: Write the failing test for `discoverRequiredChecks`**

Create `src/action/discover-checks.test.ts`. Fake the Octokit `request` method (the rules/classic reads use `octokit.request(route, params)`):

```ts
import { describe, expect, it, vi } from 'vitest';
import { discoverRequiredChecks } from './discover-checks.ts';

function octo(handlers: Record<string, unknown | (() => never)>) {
  return {
    request: vi.fn(async (route: string) => {
      const h = handlers[route];
      if (typeof h === 'function') (h as () => never)(); // throw path
      return { data: h };
    }),
  } as never;
}
const RULES = 'GET /repos/{owner}/{repo}/rules/branches/{branch}';
const CLASSIC = 'GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks';

describe('discoverRequiredChecks', () => {
  it('collects contexts from required_status_checks rules (incl. matrix legs)', async () => {
    const o = octo({
      [RULES]: [
        { type: 'pull_request', parameters: {} },
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [
              { context: 'build' },
              { context: 'integration (9.12.0)' },
              { context: 'integration (10.0.0)' },
            ],
          },
        },
      ],
    });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual([
      'build',
      'integration (9.12.0)',
      'integration (10.0.0)',
    ]);
  });
  it('falls back to classic protection when the rules endpoint yields none', async () => {
    const o = octo({ [RULES]: [], [CLASSIC]: { contexts: ['build'] } });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual(['build']);
  });
  it('returns [] when neither endpoint yields checks (both throw / empty)', async () => {
    const o = octo({
      [RULES]: () => {
        throw new Error('404');
      },
      [CLASSIC]: () => {
        throw new Error('404');
      },
    });
    expect(await discoverRequiredChecks(o, 'o', 'r', 'main')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test discover-checks`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `discoverRequiredChecks`**

Create `src/action/discover-checks.ts`:

```ts
import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

interface BranchRule {
  type: string;
  parameters?: { required_status_checks?: Array<{ context: string }> };
}

/**
 * The required status-check contexts for `base`, read from the rulesets endpoint (which
 * surfaces both classic protection and rulesets), falling back to classic protection when the
 * rules endpoint yields none. Both reads need repo-config read access — in the setup-produced
 * config the action's token is the App token with `administration: read` (spec §2.6). Any read
 * error is swallowed to `[]`; an empty set is fail-closed upstream (no-op, never approve).
 */
export async function discoverRequiredChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
): Promise<string[]> {
  const fromRules = await readRules(octokit, owner, repo, base);
  if (fromRules.length > 0) return fromRules;
  return readClassic(octokit, owner, repo, base);
}

async function readRules(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string[]> {
  try {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/rules/branches/{branch}',
      { owner, repo, branch },
    );
    const rules = data as BranchRule[];
    const contexts = rules
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c.context);
    return [...new Set(contexts)];
  } catch {
    return [];
  }
}

async function readClassic(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string[]> {
  try {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks',
      { owner, repo, branch },
    );
    return (data as { contexts?: string[] }).contexts ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test discover-checks`
Expected: PASS (3 cases).

- [ ] **Step 5: Add the `lockfileHonestyCheck` config field (failing test first)**

In `src/engine/config.test.ts`, add inside `describe('loadConfig', …)`:

```ts
  it('parses the optional lockfileHonestyCheck field', async () => {
    const config = await loadConfig(await repoWith('{"lockfileHonestyCheck":"assay"}'));
    expect(config.lockfileHonestyCheck).toBe('assay');
  });
  it('leaves lockfileHonestyCheck undefined when absent', async () => {
    const config = await loadConfig(await repoWith('{}'));
    expect(config.lockfileHonestyCheck).toBeUndefined();
  });
```

Run: `pnpm test engine/config` → FAIL (unknown key `lockfileHonestyCheck`; the outer object is strict).

- [ ] **Step 6: Add the field to `ConfigSchema` and regenerate the schema**

In `src/engine/config.ts`, add to the `ConfigSchema` object (before `.strict()`):

```ts
    lockfileHonestyCheck: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Name of the required check that proves the lockfile is honest (e.g. the lockfile-assay job/check name). When it is a required check, the "assumes the lockfile is honest" caveat is dropped from APPROVE reviews (spec §2.5).',
      ),
```

Regenerate the published schema:

Run: `pnpm gen:schema`
Expected: rewrites `schema/waiver-stamp-config.v0.schema.json`.

Run: `pnpm test engine/config`
Expected: PASS — including the drift-guard (`the committed schema/ file matches the Zod-generated output`).

- [ ] **Step 7: Write the failing resolve-checks discovery tests**

Rewrite `src/action/resolve-checks.test.ts` to drive discovery. Mock `discover-checks` and the base-config read (`fileAtRef`) so the resolver is unit-tested in isolation:

```ts
import { describe, expect, it, vi } from 'vitest';
import { makeResolveRequiredChecks } from './resolve-checks.ts';

vi.mock('./discover-checks.ts', () => ({ discoverRequiredChecks: vi.fn() }));
vi.mock('../git.ts', () => ({ fileAtRef: vi.fn() }));
import { discoverRequiredChecks } from './discover-checks.ts';
import { fileAtRef } from '../git.ts';

const octokit = {} as never;
const args = { owner: 'o', repo: 'r', base: 'b'.repeat(40), repoDir: '/tmp/x' };

function setup(discovered: string[], config: object | null) {
  vi.mocked(discoverRequiredChecks).mockResolvedValue(discovered);
  vi.mocked(fileAtRef).mockResolvedValue(config === null ? null : JSON.stringify(config));
}

describe('makeResolveRequiredChecks (autodiscovery)', () => {
  it('returns the discovered set, self-excluding waiver-stamp', async () => {
    setup(['build', 'waiver-stamp', 'assay'], {});
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(octokit, args);
    expect(r.required).toEqual(['build', 'assay']);
  });
  it('lockfileHonestyConfigured true when the base config names a discovered required check', async () => {
    setup(['build', 'assay'], { lockfileHonestyCheck: 'assay' });
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(octokit, args);
    expect(r.lockfileHonestyConfigured).toBe(true);
  });
  it('lockfileHonestyConfigured false when the named check is not required (fail-safe)', async () => {
    setup(['build'], { lockfileHonestyCheck: 'assay' });
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(octokit, args);
    expect(r.lockfileHonestyConfigured).toBe(false);
  });
  it('lockfileHonestyConfigured false when the field is unset', async () => {
    setup(['build', 'assay'], {});
    const r = await makeResolveRequiredChecks({ ciChecks: [], lockfileHonestyChecks: [] })(octokit, args);
    expect(r.lockfileHonestyConfigured).toBe(false);
  });
  it('falls back to the ci-checks override when discovery is empty (no-App path)', async () => {
    setup([], {});
    const r = await makeResolveRequiredChecks({ ciChecks: ['build'], lockfileHonestyChecks: [] })(octokit, args);
    expect(r.required).toEqual(['build']);
  });
});
```

Run: `pnpm test resolve-checks` → FAIL (current body ignores discovery).

- [ ] **Step 8: Implement the real resolver body**

Rewrite `src/action/resolve-checks.ts`:

```ts
import type { getOctokit } from '@actions/github';
import { CONFIG_FILENAME, parseConfig } from '../engine/config.ts';
import { fileAtRef } from '../git.ts';
import { discoverRequiredChecks } from './discover-checks.ts';

type Octokit = ReturnType<typeof getOctokit>;

/** The reviewer's own check-run name; never part of its own backstop set (spec §2.4). */
const WAIVER_STAMP_CHECK = 'waiver-stamp';

export interface ResolvedChecks {
  required: string[];
  lockfileHonestyConfigured: boolean;
}

/**
 * Resolve the reviewer's required-check set (autodiscovered from base-branch protection, with
 * the `ci-checks` input as the no-App fallback) and the honesty flag (a base-config-named
 * required check silences the APPROVE caveat — fail-safe: only a positive match silences it).
 */
export function makeResolveRequiredChecks(inputs: {
  ciChecks: string[];
  lockfileHonestyChecks: string[];
}) {
  return async (
    octokit: Octokit,
    args: { owner: string; repo: string; base: string; repoDir: string },
  ): Promise<ResolvedChecks> => {
    const discovered = await discoverRequiredChecks(octokit, args.owner, args.repo, args.base);
    const set = discovered.length > 0 ? discovered : inputs.ciChecks;
    const required = set.filter((name) => name !== WAIVER_STAMP_CHECK);

    const config = parseConfig(await fileAtRef(args.repoDir, args.base, CONFIG_FILENAME));
    const honesty = config.lockfileHonestyCheck;
    const lockfileHonestyConfigured = honesty !== undefined && required.includes(honesty);

    return { required, lockfileHonestyConfigured };
  };
}
```

Note the `lockfileHonestyChecks` input is now unused by the resolver — it is removed entirely in Step 10.

Run: `pnpm test resolve-checks`
Expected: PASS (5 cases).

- [ ] **Step 9: Confirm `main.test.ts` still passes with the discovery-shaped collaborator**

`main.test.ts` mocks `resolveRequiredChecks` directly (PR 0, Step 6), so it is unaffected by the body change. Run: `pnpm test action/main` → PASS.

- [ ] **Step 10: Remove the `lockfile-honesty-checks` input from the action + ncc entry**

In `.github/actions/waiver-stamp-review/action.yml`, delete the `lockfile-honesty-checks` input block (leave `ci-checks` and `github-token`).

In `src/action/main.ts` ncc entry, drop `lockfileHonestyChecks` from `inputs`:

```ts
  const inputs = {
    ciChecks: parseList(core.getInput('ci-checks')),
    lockfileHonestyChecks: [] as string[],
  };
```

Keep the field present as an empty array so `makeResolveRequiredChecks(inputs)` still type-checks (the resolver no longer reads it, but the factory's parameter shape is unchanged this PR). *The field and its parameter are fully removed in the cleanup PR (N+1).*

- [ ] **Step 11: Rebuild the action, run everything**

Run: `pnpm build:action && pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS. Stage the regenerated `dist`.

- [ ] **Step 12: Commit + PR (skills)**

Stage `src/action/discover-checks.ts(.test)`, `src/action/resolve-checks.ts(.test)`, `src/engine/config.ts(.test)`, `schema/waiver-stamp-config.v0.schema.json`, `.github/actions/waiver-stamp-review/action.yml`, `src/action/main.ts`, the rebuilt `dist`. Branch `jordi/setup-automation/setup-automation-1` off the prep branch. PR body: PR 1 of the stack (depends on PR 0), notes the V1 finding.

---

## PR 2 — Reusable workflows + dogfood

**Intent:** ship `ci.yml` and `review.yml` as `workflow_call` reusable workflows wrapping the existing composite/node actions, convert this repo's own dogfood to call them (proving the shape), and replace the copy-paste templates in `examples/` + the manual doc with the thin callers. The reviewer caller triggers on multiple workflows (`workflow_run.workflows: [CI, waiver-stamp-ci]`, `types: [completed]`), last-wake-wins (spec §2.3).

**Files:**
- Create: `.github/workflows/ci.yml` **as a reusable workflow** — but this repo already has a `.github/workflows/ci.yml` (the dogfood CI). **Do not collide.** Name the reusable producer `.github/workflows/reusable-ci.yml` and the reusable reviewer `.github/workflows/reusable-review.yml`; the adopter-facing `uses:` refs become `jsalvata/waiver-stamp/.github/workflows/reusable-ci.yml@vX` and `…/reusable-review.yml@vX`. (Rationale: this repo keeps its own `CI` workflow; the reusable ones are separate files.)
- Create: `.github/workflows/reusable-ci.yml`
- Create: `.github/workflows/reusable-review.yml`
- Modify: `.github/workflows/waiver-stamp-review.yml` (dogfood: call the reusable reviewer)
- Modify: `.github/workflows/ci.yml` (dogfood producer job: keep source-under-test stamping — see note)
- Modify: `examples/waiver-stamp-ci.yml`, `examples/waiver-stamp-review.yml` (thin callers)
- Modify: `docs/auto-approval-setup.md` (collapse the paste-and-edit steps to the callers; keep the security "why" as the manual fallback per spec §2.8)

**Interfaces:**
- Produces: reusable workflow `reusable-ci.yml` with `on: { workflow_call: {} }`, running the producer (the composite `.github/actions/waiver-stamp`).
- Produces: reusable workflow `reusable-review.yml` with `on: { workflow_call: { secrets: { … } } }`, holding the hardened checkout/fetch/guard shape and the node action `.github/actions/waiver-stamp-review`.

**Verify first:** confirm a `workflow_call` reviewer can hold `permissions: { pull-requests: write, … }` and receive an App-token secret via `secrets: inherit` from the caller (this is exercised more fully in PR 4 / V5; here just confirm the reusable file is accepted by `actionlint`).

- [ ] **Step 1: Write the reusable producer workflow**

Create `.github/workflows/reusable-ci.yml`:

```yaml
# Reusable producer (spec §2.1). Adopters call this from a standalone `waiver-stamp-ci.yml`;
# it runs waiver-stamp as unprivileged pull_request CI and publishes the `waiver-stamp` check
# plus the `waiver-stamp-report` artifact the reviewer consumes by head SHA.
name: waiver-stamp-ci-reusable
on:
  workflow_call: {}
permissions:
  contents: read
jobs:
  waiver-stamp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: jsalvata/waiver-stamp/.github/actions/waiver-stamp@v1.16.0
```

- [ ] **Step 2: Write the reusable reviewer workflow**

Create `.github/workflows/reusable-review.yml`, folding in the hardened shape from `examples/waiver-stamp-review.yml` (the security comment block moves here — versioned, per spec §2.8):

```yaml
# Reusable reviewer (spec §2.1). Holds the pwn-request defense centrally: checkout the caller's
# DEFAULT BRANCH (never the PR head), bring the head in only as git DATA, run the pinned action.
# The adopter cannot misconfigure this shape.
name: waiver-stamp-review-reusable
on:
  workflow_call:
    inputs:
      ci-checks:
        description: Optional override list of required check-run names (empty ⇒ autodiscover).
        required: false
        type: string
        default: ''
    secrets:
      app-id:
        description: GitHub App ID whose token posts the review (empty ⇒ default token).
        required: false
      app-private-key:
        description: The App private key (PEM).
        required: false
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
        with:
          ref: ${{ github.event.repository.default_branch }}
          fetch-depth: 0
          persist-credentials: false
      - name: Fetch the PR head commits (data for G1/G2 — never executed)
        env:
          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
        run: git fetch --no-tags --force origin "$HEAD_SHA"
      - name: Mint the App token (when configured)
        id: app-token
        if: ${{ secrets.app-id != '' }}
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.app-id }}
          private-key: ${{ secrets.app-private-key }}
      - uses: jsalvata/waiver-stamp/.github/actions/waiver-stamp-review@v1.16.0
        with:
          ci-checks: ${{ inputs.ci-checks }}
          github-token: ${{ steps.app-token.outputs.token || github.token }}
```

*Note (V4/V5, resolve in PR 4):* whether the App token is minted here from inherited secrets or passed pre-minted affects this step; the shape above assumes secrets flow in. Adjust if V5 shows `secrets: inherit` does not carry the App scopes into the reusable job.

- [ ] **Step 3: Lint the workflows with actionlint**

Run: `pnpm dlx actionlint .github/workflows/reusable-ci.yml .github/workflows/reusable-review.yml` (or the repo's `actionlint.yml` CI equivalent — the repo already runs actionlint in `.github/workflows/actionlint.yml`).
Expected: no errors. Fix any schema complaints (e.g. `type:` on inputs is required for `workflow_call`).

- [ ] **Step 4: Point the dogfood reviewer at the reusable workflow**

Rewrite `.github/workflows/waiver-stamp-review.yml` to call the reusable reviewer instead of inlining the shape. Because this repo uses a *local* action for source-under-test, keep a local caller that still checks out default-branch code — but the multi-workflow trigger is the change under test:

```yaml
name: waiver-stamp-review
on:
  workflow_run:
    workflows: [CI]            # this repo's producer lives in the CI workflow (build + waiver-stamp)
    types: [completed]
jobs:
  review:
    uses: ./.github/workflows/reusable-review.yml
    secrets: inherit
```

*Note:* this repo has no App secrets configured, so `secrets.app-id` is empty and the reusable reviewer falls back to `github.token` — matching today's dogfood behavior. Verify the dogfood review still posts (or no-ops fail-closed) on a test PR before merge.

- [ ] **Step 5: Replace the example templates with thin callers**

Overwrite `examples/waiver-stamp-ci.yml`:

```yaml
# Standalone producer — does NOT touch your existing CI. Drop this file in as-is.
name: waiver-stamp-ci
on: { pull_request: {} }
jobs:
  waiver-stamp:
    uses: jsalvata/waiver-stamp/.github/workflows/reusable-ci.yml@v1.16.0
```

Overwrite `examples/waiver-stamp-review.yml`:

```yaml
# Standalone reviewer. `workflow setup-repository` discovers and fills the workflows: list.
name: waiver-stamp-review
on:
  workflow_run:
    workflows: [CI, waiver-stamp-ci]   # <-- your CI workflow name(s) + waiver-stamp-ci
    types: [completed]
jobs:
  review:
    uses: jsalvata/waiver-stamp/.github/workflows/reusable-review.yml@v1.16.0
    secrets: inherit
```

- [ ] **Step 6: Collapse the manual doc to the callers (keep the "why" as fallback)**

In `docs/auto-approval-setup.md`, replace the two paste-the-100-line-file steps with "drop these two thin callers" pointing at `examples/`, and keep the pwn-request explanation as the manual-fallback narrative (spec §2.8). Do not narrate the removal (no "previously you pasted…"); describe the current callers only.

- [ ] **Step 7: Run repo checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS (no source changed; this is a workflow/docs PR). Confirm `actionlint` CI is green.

- [ ] **Step 8: Verify the dogfood end-to-end on a scratch PR**

Open a throwaway PR against this repo (or push to the PR branch) and confirm: the `CI` workflow's `waiver-stamp` job publishes the artifact, `waiver-stamp-review` wakes on `CI` completion, and the reviewer posts its usual outcome. Evidence: the Actions run + the posted review (or fail-closed log). This is the behavioral proof the reusable shape works.

- [ ] **Step 9: Commit + PR (skills)**

Branch `jordi/setup-automation/setup-automation-2` off PR 1. PR body: PR 2 of the stack; reusable workflows + dogfood + example/doc collapse; note the naming (`reusable-*.yml`) to avoid colliding with this repo's own `CI`.

---

## PR 3 — App manifest + loopback core

**Intent:** the reusable building blocks Component C orchestrates: build the App manifest (name/scopes/sanitize), run the loopback create→convert handshake, and open the browser. No secrets are written and no repo config is touched in this PR — it is a pure library with unit tests against a fake GitHub, wired into nothing yet.

**Verify first (V3):** confirm GitHub accepts an `http://localhost:<port>` (loopback) `redirect_url` in the manifest flow. Probot relies on it; confirm against the current docs. If GitHub requires `127.0.0.1` literal vs `localhost`, use whichever it accepts consistently in the manifest and the bind.

**Files:**
- Create: `src/setup/manifest.ts`, `src/setup/manifest.test.ts`
- Create: `src/setup/pages.ts` (HTML for the self-POST form, the "done — install" page)
- Create: `src/setup/loopback.ts`, `src/setup/loopback.test.ts`

**Interfaces:**
- Produces: `appSlugName(owner: string): string` — sanitized `waiver-stamp-<owner>`, slug charset, length-capped with a short hash suffix.
- Produces: `buildManifest(args: { owner: string; appUrl: string }): AppManifest` — the object POSTed to GitHub.
- Produces: `runManifestFlow(deps): Promise<{ appId: number; pem: string; slug: string }>` — binds loopback, opens the browser to the self-POST form, captures `?code=&state=`, verifies `state`, POSTs the conversion, returns the credentials. Browser-open and the conversion HTTP call are injected for testability.

- [ ] **Step 1: Failing tests for `appSlugName` + `buildManifest`**

Create `src/setup/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { appSlugName, buildManifest } from './manifest.ts';

describe('appSlugName', () => {
  it('suffixes the owner login in the slug charset', () => {
    expect(appSlugName('jsalvata')).toBe('waiver-stamp-jsalvata');
  });
  it('lowercases and hyphenates non-alphanumerics', () => {
    expect(appSlugName('My_Org.Name')).toBe('waiver-stamp-my-org-name');
  });
  it('caps length and appends a short deterministic hash for long owners', () => {
    const name = appSlugName('a'.repeat(60));
    expect(name.length).toBeLessThanOrEqual(34); // GitHub App name cap headroom
    expect(name.startsWith('waiver-stamp-')).toBe(true);
  });
});

describe('buildManifest', () => {
  it('carries the exact scopes and no events/webhook', () => {
    const m = buildManifest({ owner: 'jsalvata', appUrl: 'https://github.com/jsalvata/waiver-stamp' });
    expect(m.name).toBe('waiver-stamp-jsalvata');
    expect(m.public).toBe(false);
    expect(m.default_permissions).toEqual({
      contents: 'write',
      pull_requests: 'write',
      administration: 'read',
    });
    expect(m.default_events).toEqual([]);
  });
});
```

Run: `pnpm test setup/manifest` → FAIL (module not found).

- [ ] **Step 2: Implement `manifest.ts`**

Create `src/setup/manifest.ts`:

```ts
import { createHash } from 'node:crypto';

export interface AppManifest {
  name: string;
  url: string;
  public: false;
  default_permissions: { contents: 'write'; pull_requests: 'write'; administration: 'read' };
  default_events: [];
  redirect_url?: string;
}

const NAME_CAP = 34; // GitHub App names must be ≤ 34 chars; keep headroom for the slug.

/** Deterministic, slug-safe `waiver-stamp-<owner>` (the global-namespace reuse key, spec §3.1). */
export function appSlugName(owner: string): string {
  const slug = owner.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const full = `waiver-stamp-${slug}`;
  if (full.length <= NAME_CAP) return full;
  const hash = createHash('sha256').update(owner).digest('hex').slice(0, 6);
  const keep = NAME_CAP - 'waiver-stamp-'.length - hash.length - 1;
  return `waiver-stamp-${slug.slice(0, keep)}-${hash}`;
}

/** The App-Manifest object (spec §3.1). `redirect_url` is filled per-run by the loopback flow. */
export function buildManifest(args: { owner: string; appUrl: string }): AppManifest {
  return {
    name: appSlugName(args.owner),
    url: args.appUrl,
    public: false,
    default_permissions: { contents: 'write', pull_requests: 'write', administration: 'read' },
    default_events: [],
  };
}
```

Run: `pnpm test setup/manifest` → PASS.

- [ ] **Step 3: Implement the HTML pages (no test — pure strings, exercised via loopback test)**

Create `src/setup/pages.ts`:

```ts
import type { AppManifest } from './manifest.ts';

/**
 * A self-submitting form that POSTs the manifest to GitHub's App-creation endpoint. GitHub's
 * manifest flow requires a form POST (the manifest rides in a `manifest` field), so the loopback
 * server serves this page and the browser submits it.
 */
export function formPage(action: string, manifest: AppManifest): string {
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset=utf-8><title>Create waiver-stamp App</title>
<body onload="document.forms[0].submit()">
<form action="${action}" method="post">
<input type="hidden" name="manifest" value='${json.replace(/'/g, '&#39;')}'>
<noscript><button type="submit">Create the waiver-stamp GitHub App</button></noscript>
</form>`;
}

/** Shown after the conversion succeeds; links the interactive install page (spec §3.3). */
export function donePage(installUrl: string): string {
  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — install</title>
<body><h1>App created ✓</h1><p>Last step: <a href="${installUrl}">install it on your repository</a>,
then return to your terminal.</p>`;
}
```

- [ ] **Step 4: Failing test for `runManifestFlow` (loopback handshake)**

Create `src/setup/loopback.test.ts`. Drive the flow end-to-end against the local server by injecting a fake "browser" that performs the GitHub side (submits the form → redirects to the callback with a code) and a fake conversion:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runManifestFlow } from './loopback.ts';
import { buildManifest } from './manifest.ts';

describe('runManifestFlow', () => {
  it('captures the code on loopback, verifies state, converts, returns credentials', async () => {
    const manifest = buildManifest({ owner: 'o', appUrl: 'https://github.com/jsalvata/waiver-stamp' });
    const convert = vi.fn(async (code: string) => {
      expect(code).toBe('abc123');
      return { appId: 42, pem: '-----BEGIN…', slug: 'waiver-stamp-o' };
    });
    // Fake browser: fetch the form page, then hit the callback as GitHub would.
    const openBrowser = vi.fn(async (formUrl: string) => {
      const base = new URL(formUrl).origin;
      const page = await fetch(formUrl).then((r) => r.text());
      const state = new URL(formUrl).searchParams.get('state');
      expect(page).toContain('method="post"');
      await fetch(`${base}/callback?code=abc123&state=${state}`);
    });

    const creds = await runManifestFlow({
      target: { kind: 'personal' },
      manifest,
      appUrl: 'https://github.com/jsalvata/waiver-stamp',
      openBrowser,
      convert,
    });
    expect(creds).toEqual({ appId: 42, pem: '-----BEGIN…', slug: 'waiver-stamp-o' });
    expect(convert).toHaveBeenCalledOnce();
  });

  it('rejects a callback whose state does not match (CSRF guard)', async () => {
    const manifest = buildManifest({ owner: 'o', appUrl: 'https://x' });
    const openBrowser = vi.fn(async (formUrl: string) => {
      const base = new URL(formUrl).origin;
      await fetch(`${base}/callback?code=abc123&state=WRONG`);
    });
    await expect(
      runManifestFlow({
        target: { kind: 'personal' },
        manifest,
        appUrl: 'https://x',
        openBrowser,
        convert: vi.fn(),
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/state/i);
  });
});
```

Run: `pnpm test setup/loopback` → FAIL (module not found).

- [ ] **Step 5: Implement `loopback.ts`**

Create `src/setup/loopback.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import type { AppManifest } from './manifest.ts';
import { donePage, formPage } from './pages.ts';

export interface ManifestFlowDeps {
  target: { kind: 'personal' } | { kind: 'org'; org: string };
  manifest: AppManifest;
  appUrl: string;
  /** Open the loopback form URL in the user's browser (or print it). */
  openBrowser: (url: string) => Promise<void>;
  /** POST /app-manifests/{code}/conversions and return the created App credentials. */
  convert: (code: string) => Promise<{ appId: number; pem: string; slug: string }>;
  timeoutMs?: number;
}

/** GitHub's App-creation POST target for the chosen owner (spec §3.2). */
function createAction(target: ManifestFlowDeps['target']): string {
  return target.kind === 'org'
    ? `https://github.com/organizations/${target.org}/settings/apps/new`
    : 'https://github.com/settings/apps/new';
}

/**
 * Run the loopback App-Manifest handshake (spec §3.2). Binds 127.0.0.1 on an ephemeral port,
 * serves a self-POST form carrying the manifest + a loopback `redirect_url`, captures the
 * single-use `code` on `/callback` (verifying `state`), converts it, and returns the App id +
 * pem + slug. The code never leaves the machine; the server is single-shot and short-lived.
 */
export function runManifestFlow(
  deps: ManifestFlowDeps,
): Promise<{ appId: number; pem: string; slug: string }> {
  const state = randomBytes(16).toString('hex');
  const timeoutMs = deps.timeoutMs ?? 5 * 60_000;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/') {
        const redirect = `http://127.0.0.1:${port}/callback`;
        const manifest = { ...deps.manifest, redirect_url: redirect };
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(formPage(createAction(deps.target), manifest));
        return;
      }
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400).end('state mismatch');
          finish(new Error('manifest flow: state mismatch (possible CSRF) — aborting'));
          return;
        }
        if (!code) {
          res.writeHead(400).end('missing code');
          finish(new Error('manifest flow: no code in callback'));
          return;
        }
        deps
          .convert(code)
          .then((creds) => {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(donePage(`https://github.com/apps/${creds.slug}/installations/new`));
            finish(null, creds);
          })
          .catch((err) => {
            res.writeHead(500).end('conversion failed');
            finish(err instanceof Error ? err : new Error(String(err)));
          });
        return;
      }
      res.writeHead(404).end();
    });

    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('manifest flow: timed out waiting for the browser callback')),
      timeoutMs,
    );
    function finish(err: Error | null, creds?: { appId: number; pem: string; slug: string }) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve(creds!);
    }

    let port = 0;
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      deps.openBrowser(`http://127.0.0.1:${port}/?state=${state}`).catch(finish);
    });
  });
}
```

Run: `pnpm test setup/loopback`
Expected: PASS (both cases).

- [ ] **Step 6: Repo checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. (`AddressInfo` import may need `import type` — adjust to satisfy Biome/tsc: `import type { AddressInfo } from 'node:net';`.)

- [ ] **Step 7: Commit + PR (skills)**

Branch `jordi/setup-automation/setup-automation-3` off PR 2. PR body: PR 3 of the stack; manifest + loopback core, unit-tested against a fake GitHub, wired into nothing yet; note the V3 finding.

---

## PR 4 — `waiver setup-repository` orchestration

**Intent:** the interactive command that ties it together. Heaviest PR. Build it as small, individually-tested modules under `src/setup/`, then a thin orchestrator wired into `cli.ts`. **Split marker:** if the diff approaches ~1000 lines, ship the provisioning half (preflight, target, App resolution, secrets — Steps 1–8) as `setup-automation-4a` and the repo-config half (ruleset, commitlint, workflow drop, hand-off — Steps 9–15) as `setup-automation-4b` off it.

**Verify first (V4, V5):** confirm the reviewer's App token is read from org-scoped secrets identically to repo-scoped through `create-github-app-token`, and that `secrets: inherit` carries the App scopes into the reusable reviewer job (PR 2's `reusable-review.yml`). Adjust the secret-provisioning and the reusable reviewer's token step if either differs.

**Files:**
- Create: `src/setup/preflight.ts` (+ test) — prerequisite checks
- Create: `src/setup/gh.ts` (+ test) — typed thin wrapper over `gh` shelling (owner/repo, orgs, secrets, ruleset, installation poll)
- Create: `src/setup/secrets.ts` (+ test) — write the two conventional secrets (org or repo scope)
- Create: `src/setup/ruleset.ts` (+ test) — the dedicated `waiver-stamp` ruleset (idempotent)
- Create: `src/setup/workflows.ts` (+ test) — discover CI workflow name(s) + lockfile-assay check name; write the two callers non-destructively
- Create: `src/setup/commitlint.ts` (+ test) — empirical `body-max-line-length` detection
- Create: `src/setup/config-seed.ts` (+ test) — seed a closed-by-default `.waiver-stamp.json` only when absent
- Create: `src/setup/handoff.ts` (+ test) — the instructions-only hand-off page
- Create: `src/commands/setup-repository.ts` (+ test) — the orchestrator
- Modify: `src/cli.ts` — register the `setup-repository` command
- Modify: `README.md` — point the happy path at `waiver setup-repository`

**Interfaces (key signatures the orchestrator consumes):**
- `preflight(cwd): Promise<{ owner: string; repo: string; defaultBranch: string; pnpm: boolean }>` — throws a `SetupError` (mapped to EXIT 2) on any hard failure.
- `discoverCiWorkflowNames(dotGithubDir): Promise<string[]>` and `detectLockfileHonestyCheck(dotGithubDir): Promise<string | null>`.
- `writeCallerWorkflows(dir, { ciWorkflowNames }): Promise<{ written: string[]; skipped: string[] }>` — never overwrites.
- `provisionSecrets(gh, { target, appId, pem, owner, repo }): Promise<void>`.
- `ensureWaiverStampRuleset(gh, { owner, repo, defaultBranch }): Promise<'created' | 'exists'>`.

Because PR 4 is large, the steps below are grouped; each group is TDD (failing test → impl → green) and the group's module is committed before the next. Only the load-bearing code is shown in full; prompt/print strings are written inline in the impl step (no placeholders — write the real string).

### PR 4 — Group A: preflight + gh wrapper

- [ ] **Step 1: Failing test for `preflight`**

Create `src/setup/preflight.test.ts` driving a fake `gh`/`git` runner (inject a `run(cmd, args): Promise<{ stdout; code }>` seam so no real shell is needed):

```ts
import { describe, expect, it, vi } from 'vitest';
import { preflight } from './preflight.ts';
import { SetupError } from './errors.ts';

function runner(map: Record<string, { stdout?: string; code?: number }>) {
  return vi.fn(async (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    const hit = Object.entries(map).find(([k]) => key.startsWith(k));
    if (!hit) throw new Error(`unexpected: ${key}`);
    return { stdout: hit[1].stdout ?? '', code: hit[1].code ?? 0 };
  });
}

const ok = {
  'git rev-parse --is-inside-work-tree': { stdout: 'true' },
  'git remote get-url origin': { stdout: 'https://github.com/jsalvata/demo.git' },
  'git symbolic-ref refs/remotes/origin/HEAD': { stdout: 'refs/remotes/origin/main' },
  'gh auth status': { stdout: 'Logged in' },
};

describe('preflight', () => {
  it('resolves owner/repo/defaultBranch and detects pnpm', async () => {
    const r = await preflight('/repo', {
      run: runner(ok),
      exists: async (p: string) => p.endsWith('pnpm-lock.yaml'),
    });
    expect(r).toMatchObject({ owner: 'jsalvata', repo: 'demo', defaultBranch: 'main', pnpm: true });
  });
  it('throws SetupError with remediation when gh is unauthenticated', async () => {
    await expect(
      preflight('/repo', {
        run: runner({ ...ok, 'gh auth status': { code: 1 } }),
        exists: async () => false,
      }),
    ).rejects.toBeInstanceOf(SetupError);
  });
});
```

- [ ] **Step 2: `SetupError` + `preflight` impl**

Create `src/setup/errors.ts`:

```ts
/** A preflight/setup failure with a user-facing remediation. Mapped to EXIT.MALFORMED (spec §4.12). */
export class SetupError extends Error {
  constructor(
    message: string,
    readonly remediation: string,
  ) {
    super(message);
    this.name = 'SetupError';
  }
}
```

Create `src/setup/preflight.ts`:

```ts
import { join } from 'node:path';
import { SetupError } from './errors.ts';

export interface PreflightDeps {
  run: (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>;
  exists: (path: string) => Promise<boolean>;
}
export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  pnpm: boolean;
}

export async function preflight(cwd: string, deps: PreflightDeps): Promise<RepoContext> {
  const inTree = await deps.run('git', ['rev-parse', '--is-inside-work-tree']);
  if (inTree.code !== 0 || inTree.stdout.trim() !== 'true')
    throw new SetupError('not inside a git work tree', 'Run this from inside your repository checkout.');

  const remote = await deps.run('git', ['remote', 'get-url', 'origin']);
  const m = remote.stdout.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (remote.code !== 0 || !m)
    throw new SetupError('no GitHub origin remote', 'Add a GitHub `origin` remote and retry.');
  const [, owner, repo] = m;

  const head = await deps.run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  const defaultBranch = head.stdout.trim().replace('refs/remotes/origin/', '') || 'main';

  const auth = await deps.run('gh', ['auth', 'status']);
  if (auth.code !== 0)
    throw new SetupError(
      'gh is not authenticated',
      'Run `gh auth login` with an account that can administer this repository, then retry.',
    );

  const pnpm = await deps.exists(join(cwd, 'pnpm-lock.yaml'));
  return { owner: owner!, repo: repo!, defaultBranch, pnpm };
}
```

Run: `pnpm test setup/preflight` → PASS.

- [ ] **Step 3: `gh.ts` wrapper (failing test → impl)**

Create `src/setup/gh.test.ts` + `src/setup/gh.ts`: a thin typed wrapper around the injected `run` seam for the calls the orchestrator needs — `listOrgs()`, `setSecret({scope, name, value, repo?, org?})`, `getRuleset/createRuleset`, `getInstallation(owner, repo)`. Each method is a one-liner mapping to `gh api`/`gh secret set` args; the test asserts the argv it builds and parses the JSON stdout. (Write one `it` per method asserting the exact `gh` argv; keep it mechanical.)

Run: `pnpm test setup/gh` → PASS.

- [ ] **Step 4: Commit Group A (skill)** — `preflight`, `errors`, `gh`, tests.

### PR 4 — Group B: App resolution + secrets

- [ ] **Step 5: Failing test for `resolveApp` (reuse → disk → fresh)**

Create `src/setup/resolve-app.test.ts` covering the spec §4.3 resolution order: org-with-existing-secrets → skip (no pem); personal-with-disk-file → load; otherwise → run `runManifestFlow`. Inject the manifest flow + a fake disk + `gh`. Assert which branch each scenario takes.

- [ ] **Step 6: Implement `resolve-app.ts`**

`resolveApp(deps): Promise<{ appId?: number; pem?: string; slug: string; source: 'reuse-org' | 'disk' | 'fresh' }>` — implements the §4.3 order, calling `runManifestFlow` (PR 3) for the fresh path and reading/writing `~/.waiver-install/<owner>.json` at `chmod 600` (dir `700`) only for the personal opt-in (§4.4). Never persist for org targets.

Run: `pnpm test setup/resolve-app` → PASS.

- [ ] **Step 7: Failing test for `provisionSecrets`**

Create `src/setup/secrets.test.ts`: org target → `gh secret set --org <org> --repos <repo>` for both `WAIVER_STAMP_APP_ID` and `WAIVER_STAMP_APP_PRIVATE_KEY`; personal target → `gh secret set --repo owner/repo`. Assert the argv and that the pem is passed via stdin, never argv. Assert we only ever write those two names.

- [ ] **Step 8: Implement `secrets.ts`; commit Group B (skill)**

`provisionSecrets(gh, { target, appId, pem, owner, repo })` — writes exactly the two conventional secrets at the target scope; idempotent (overwriting our own names is fine); touches no other secret (spec §4.5).

Run: `pnpm test setup/secrets` → PASS.

### PR 4 — Group C: repo config (ruleset, commitlint, workflows, config seed)

- [ ] **Step 9: `ensureWaiverStampRuleset` (failing test → impl)**

Create `src/setup/ruleset.test.ts` + `src/setup/ruleset.ts`. The ruleset is a dedicated `waiver-stamp` ruleset on the default branch requiring only the `waiver-stamp` check (spec §4.6). Idempotent: if a ruleset named `waiver-stamp` already exists, return `'exists'` and do not recreate. Test both branches against the fake `gh`.

```ts
// ruleset.ts core
export async function ensureWaiverStampRuleset(
  gh: GhClient,
  args: { owner: string; repo: string; defaultBranch: string },
): Promise<'created' | 'exists'> {
  const existing = await gh.listRulesets(args.owner, args.repo);
  if (existing.some((r) => r.name === 'waiver-stamp')) return 'exists';
  await gh.createRuleset(args.owner, args.repo, {
    name: 'waiver-stamp',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [`refs/heads/${args.defaultBranch}`], exclude: [] } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: 'waiver-stamp' }],
        },
      },
    ],
  });
  return 'created';
}
```

Run: `pnpm test setup/ruleset` → PASS.

- [ ] **Step 10: `detectCommitlintBodyLimit` (empirical, failing test → impl)**

Create `src/setup/commitlint.test.ts` + `src/setup/commitlint.ts`. Run the repo's `commit-msg` hook (or `npx commitlint`) against a synthetic message with a >100-char body line, read the exit code, **warn** if it rejects (naming the `body-max-line-length: [0]` fix) — never edit their config (spec §4.7). Inject the runner; test the reject → `{ blocks: true }` and pass → `{ blocks: false }` branches. (This repo's own `commitlint.config.js` already sets `body-max-line-length: [0]`, so a self-test would return `blocks: false` — a good integration fixture.)

Run: `pnpm test setup/commitlint` → PASS.

- [ ] **Step 11: `workflows.ts` — discovery + non-destructive write (failing test → impl)**

Create `src/setup/workflows.test.ts` + `src/setup/workflows.ts`:
- `discoverCiWorkflowNames(dotGithubDir)` — read `.github/workflows/*.yml` `name:` fields (skip our own `waiver-stamp-*`); return the list to bake into the reviewer caller's `workflow_run.workflows`.
- `detectLockfileHonestyCheck(dotGithubDir)` — scan workflow YAML for a job using the `lockfile-assay` action/package; return its job/check name or `null`.
- `writeCallerWorkflows(dir, { ciWorkflowNames })` — write `waiver-stamp-ci.yml` + `waiver-stamp-review.yml` from the PR-2 caller templates with `workflows:` filled; **if either path exists, skip it and record it in `skipped[]`** (never overwrite — spec §4.8). Return `{ written, skipped }`.

Test: a fixture `.github/workflows/` dir (via `scaffoldProject`/tmp) with a `CI` workflow and a `lockfile-assay` job → discovery returns `['CI']` and the honesty check name; `writeCallerWorkflows` writes both callers; a second call skips both.

Run: `pnpm test setup/workflows` → PASS.

- [ ] **Step 12: `config-seed.ts` (failing test → impl)**

Create `src/setup/config-seed.test.ts` + `src/setup/config-seed.ts`. `seedConfigIfAbsent(dir, { lockfileHonestyCheck })`: if `.waiver-stamp.json` is **absent**, write the closed-by-default template (the README's recommended `changeDocs.allow/deny`, `allowBumping: []`, plus `lockfileHonestyCheck` if detected). If it **exists**, do nothing and return `{ seeded: false, existing: true }` (the hand-off page surfaces the suggested edit — spec §4.11). Never widen an existing policy.

Run: `pnpm test setup/config-seed` → PASS.

- [ ] **Step 13: `handoff.ts` (failing test → impl)**

Create `src/setup/handoff.test.ts` + `src/setup/handoff.ts`. `handoffPage({ owner, repo, slug, defaultBranch, installDetected, configExisted, suggestedHonestyCheck })` returns the instructions-only HTML (spec §4.10): confirm install (if not detected), review `.waiver-stamp.json` (+ the suggested `lockfileHonestyCheck` edit if `configExisted` and detected), set merge/rebase (not squash), optional `.github/**` protection — terse imperatives, `owner/repo`/slug/branch interpolated, a single link to `docs/auto-approval-setup.md` at the bottom, no rationale. Test asserts the interpolated repo slug and that each conditional line appears/omits correctly.

Run: `pnpm test setup/handoff` → PASS.

- [ ] **Step 14: Commit Group C (skill)** — ruleset, commitlint, workflows, config-seed, handoff + tests.

### PR 4 — Group D: orchestrator + CLI wiring

- [ ] **Step 15: Failing test for the orchestrator (phased, idempotent)**

Create `src/commands/setup-repository.test.ts`. Inject every collaborator (preflight, resolveApp, provisionSecrets, writeCallerWorkflows, ensureWaiverStampRuleset, openBrowser, gh) and assert the **phase ordering** (spec §4.13): open the workflows PR / write callers **before** the ruleset; the ruleset step is gated on the producer having run (poll installation/check, or exit with the "merge then re-run" message). Cover: fresh run stops at the merge boundary with a clear message (exit 0); resumed run with the check present creates the ruleset. Assert `--no-app` skips App provisioning and takes the override path.

- [ ] **Step 16: Implement `setup-repository.ts`**

Create `src/commands/setup-repository.ts` — the orchestrator calling the Group A–C modules in order, honoring `--yes/--target/--no-app`, printing progress, and ending by opening the hand-off page. Gate the ruleset on the `waiver-stamp` check existing on a recent head SHA; otherwise print `merge the opened PR, then re-run \`waiver setup-repository\` to finish` and return (exit 0). Idempotent: every mutating step checks current state first (workflows skip-if-exists, secrets overwrite-own, ruleset exists→no-op, config seed-if-absent).

```ts
export interface SetupOptions {
  yes?: boolean;
  target?: string; // 'personal' | '<org>'
  noApp?: boolean;
  cwd?: string;
}

export async function setupRepository(opts: SetupOptions, deps: SetupDeps): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const ctx = await deps.preflight(cwd, deps.preflightDeps); // throws SetupError → EXIT 2
  if (!ctx.pnpm) deps.warn('no pnpm-lock.yaml found — the dependency-bump op will be inert (spec §4.1).');

  const target = await deps.chooseTarget(opts.target, deps.gh); // §4.2 (org recommended)
  const app = opts.noApp ? null : await deps.resolveApp({ target, owner: ctx.owner, ... });
  if (app) await deps.provisionSecrets(deps.gh, { target, ...app, owner: ctx.owner, repo: ctx.repo });

  const ciNames = await deps.discoverCiWorkflowNames(join(cwd, '.github/workflows'));
  const honesty = await deps.detectLockfileHonestyCheck(join(cwd, '.github/workflows'));
  const drop = await deps.writeCallerWorkflows(cwd, { ciWorkflowNames: ciNames });
  await deps.seedConfigIfAbsent(cwd, { lockfileHonestyCheck: honesty ?? undefined });
  const commit = await deps.detectCommitlintBodyLimit(cwd);
  if (commit.blocks) deps.warn('commitlint rejects long body lines; set `body-max-line-length: [0]` (spec §4.7).');

  if (app) await deps.openBrowser(`https://github.com/apps/${app.slug}/installations/new`);

  // Phase boundary (§4.13): the ruleset requires the producer to have reported once.
  const checkExists = await deps.waiverStampCheckPresent(deps.gh, ctx);
  if (!checkExists) {
    deps.info('Open the workflows PR and merge it, then re-run `waiver setup-repository` to add the required-check ruleset.');
  } else {
    await deps.ensureWaiverStampRuleset(deps.gh, ctx);
  }
  await deps.openBrowser(deps.handoffPage({ ...ctx, slug: app?.slug, ... }));
}
```

Run: `pnpm test setup-repository` → PASS.

- [ ] **Step 17: Wire into `cli.ts`**

Add to `src/cli.ts` (mirroring the existing commands + the `run()` exit-code mapper):

```ts
import { setupRepository } from './commands/setup-repository.ts';
import { SetupError } from './setup/errors.ts';
// …
program
  .command('setup-repository')
  .description('interactively wire waiver-stamp into the current repo (spec §4)')
  .option('--yes', 'accept recommended defaults for non-destructive prompts')
  .option('--target <target>', 'install target: personal or an org login')
  .option('--no-app', 'skip App provisioning; configure the human-click layer only')
  .action(async (opts: { yes?: boolean; target?: string; app?: boolean }) => {
    await run(async () => {
      await setupRepository(
        { yes: opts.yes, target: opts.target, noApp: opts.app === false, cwd: process.cwd() },
        makeSetupDeps(),
      );
    });
  });
```

Add a `SetupError` branch to `run()`'s catch (before the generic `else`), mapping to `EXIT.MALFORMED` and printing `error: ${err.message}\n  ${err.remediation}`. (`--no-app` → commander sets `opts.app = false`.)

- [ ] **Step 18: CLI smoke test + README**

Extend the CI smoke test (or add a `cli.test.ts` case) asserting `node dist/cli.js setup-repository --help` exits 0 and mentions `--no-app`. Update `README.md` to point the happy path at `waiver setup-repository` with a link to `docs/auto-approval-setup.md` (spec §2.8). Do not narrate the old manual flow's removal.

- [ ] **Step 19: Full build + suite + lint + typecheck**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS, schema drift-guard green.

- [ ] **Step 20: Behavioral verification (dry-run against a scratch repo)**

Run `waiver setup-repository --no-app` (via `pnpm dev setup-repository --no-app`) inside a throwaway checkout with a GitHub `origin`: confirm preflight resolves owner/repo, the callers are written (and skipped on re-run), the phase-boundary message prints, and the hand-off page opens. Evidence: the terminal transcript + the written files. (Full App path needs a real GitHub account — exercise it manually once, out of band.)

- [ ] **Step 21: Commit + PR (skills)**

Branch `jordi/setup-automation/setup-automation-4` off PR 3. PR body: PR 4 of the stack; the orchestrator + modules; note V4/V5 findings and the split marker if it grew past ~1000 lines.

---

## PR N+1 — Cleanup refactor

**Intent:** remove the residue the feature left behind. Pure removal — suite green before and after, no behavior change.

**Files:**
- Modify: `src/action/main.ts` (drop the vestigial `lockfileHonestyChecks` field from the ncc `inputs` and from `makeResolveRequiredChecks`'s parameter)
- Modify: `src/action/resolve-checks.ts` (drop the unused `lockfileHonestyChecks` from the factory's parameter type)
- Modify: `docs/auto-approval-setup.md` (delete the pre-autodiscovery `ci-checks`-required narration; keep only the empty-override note)
- Modify: `examples/` / any remaining `lockfile-honesty-checks` references

- [ ] **Step 1: Remove the vestigial honesty-list plumbing**

In `src/action/resolve-checks.ts`, change the factory parameter from `{ ciChecks: string[]; lockfileHonestyChecks: string[] }` to `{ ciChecks: string[] }`. In `src/action/main.ts` ncc entry, change `inputs` to `{ ciChecks: parseList(core.getInput('ci-checks')) }`. Update any test constructing the factory to pass `{ ciChecks: [...] }` only.

- [ ] **Step 2: Run the suite (green — the field was already unread since PR 1)**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:action`
Expected: PASS. Stage the rebuilt `dist`.

- [ ] **Step 3: Delete the stale manual-list narration from the docs/examples**

In `docs/auto-approval-setup.md`, remove the passages describing the hand-maintained `ci-checks` list and matrix-leg/push-only footguns as *current* steps (autodiscovery replaced them); keep a one-line note that `ci-checks` remains an empty-by-default override for the no-App path. Describe only what is — no "previously" narration (no-archaeology).

- [ ] **Step 4: Repo checks + commit + PR (skills)**

Run: `pnpm test && pnpm lint`. Branch `jordi/setup-automation/cleanup-setup-automation` off PR 4. PR body: cleanup PR (N+1); pure removal of dead honesty-list plumbing and stale doc narration.

---

## Self-review notes

- **Spec coverage:** §2.1 → PR 2; §2.2–2.3 → PR 2 (trigger model) + PR 0/1 (backstop unchanged); §2.4 → PR 1; §2.5 → PR 1 (config field + fail-safe match); §2.6 → PR 1 (App token via the action's `github-token`) + PR 3 manifest scope; §2.7 → PR 1 (`ci-checks` override kept); §2.8 → PR 2/PR 4 docs; §3 → PR 3; §4.1 → PR 4 Group A; §4.2 → Group D `chooseTarget`; §4.3–4.4 → Group B `resolveApp`; §4.5 → Group B `secrets`; §4.6 → Group C `ruleset`; §4.7 → Group C `commitlint`; §4.8 → Group C `workflows`; §4.9 → Group D `openBrowser` install; §4.10 → Group C `handoff`; §4.11 → Group C `config-seed`; §4.12 → CLI wiring + `SetupError`→EXIT 2; §4.13 → Group D phase boundary; §8 → the PR stack.
- **Verification gates:** V1 (PR 1), V3 (PR 3), V4/V5 (PR 4) each resolved at the top of their PR; the spec's conservative assumption is the default and the PR body records any deviation.
- **Type consistency:** `ResolvedChecks` / `makeResolveRequiredChecks` signatures match between PR 0 (factory shape) and PR 1 (body); `discoverRequiredChecks` signature is stable; the self-exclusion constant is the single literal `'waiver-stamp'`; secret names are the two literals `WAIVER_STAMP_APP_ID` / `WAIVER_STAMP_APP_PRIVATE_KEY` throughout.
- **Naming caution:** PR 2 names the reusable workflows `reusable-ci.yml` / `reusable-review.yml` to avoid colliding with this repo's existing `ci.yml`; the spec's §2.1 example `uses:` refs (`…/ci.yml@vX`) are updated to the `reusable-*` paths — flag this in the PR 2 body since the spec text says `ci.yml`.
