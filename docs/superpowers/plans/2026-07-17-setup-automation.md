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

Reasoning order: feature spike → prep → cleanup. Ship order: 0 → 1..N → N+1. Each feature PR is an independently **end-to-end testable** increment — the CLI is grown one runnable capability at a time rather than landed as one mega-PR (mirrors spec §8, resliced for reviewability).

- **PR 0 — Prep refactor** (`prep-check-resolution` off `main`): extract the reviewer's inline backstop-set + honesty-flag computation (`main.ts:62`, `main.ts:93`) behind a `resolveRequiredChecks` seam that today returns the static inputs. Behavior-preserving, full suite green before/after.
  Removes friction: *"the backstop set and honesty flag are computed inline from inputs, so autodiscovery can't be slotted in without editing `run()`."*
- **PRs 1..N — Feature:**
  - **PR 1 — Autodiscovery** (`setup-automation-1` off prep): implement the seam against the rules endpoint (App token), self-exclude `waiver-stamp`, read the honesty-check name from a new `.waiver-stamp.json` field, keep the empty `ci-checks` override, remove `lockfile-honesty-checks` — plus the *targeted* doc/example fix that keeps `main` consistent (the removed input can't linger in the example). **E2E:** the reviewer discovers required checks on a test PR. Landed in PR 1: union discovery (rules endpoint + classic protection, unioned), empty-union fail-closed, the `allowBumping`-gated lockfile caveat, and the `lockfileHonestyChecks` param removal — narrowing the cleanup PR's (N+1) remaining scope.
  - **PR 2 — Reusable workflows** (`setup-automation-2` off PR 1): reusable `workflow_call` producer/reviewer wrapping the existing actions; multi-workflow trigger; dogfood this repo onto its own callers; full caller-based adopter docs (`examples/`, `docs/auto-approval-setup.md`). **E2E:** the dogfood review posts via the reusable shape.
  - **PR 3 — Preflight + orchestrator skeleton** (`setup-automation-3` off PR 2): `waiver setup-repository` that validates prerequisites and reports — the CLI wiring, `SetupError`→EXIT 2, and the orchestrator skeleton that PRs 4–6 grow. No repo mutation yet. **E2E:** run it in a real repo, watch it resolve owner/repo/branch/pnpm and print the remaining-steps summary. *(No `--check` flag — spec §4.1 rejects one; this is just the orchestrator's partial first version.)*
  - **PR 4 — App provisioning, fresh path** (`setup-automation-4` off PR 3): manifest builder + loopback handshake + target choice + secret write, wired into the orchestrator so the command actually creates an App and provisions secrets. **Excludes** reuse/disk (PR 5). **E2E:** run it, click the two GitHub buttons, get a real App and two repo/org secrets.
  - **PR 5 — App reuse + pem-on-disk** (`setup-automation-5` off PR 4): the idempotent/multi-repo layer on the fresh path — reuse an existing org App with no pem (§4.3), personal pem-on-disk opt-in (§4.4). **E2E:** re-run reuses the org App / loads the disk key instead of re-minting.
  - **PR 6 — Repo config + phase boundary** (`setup-automation-6` off PR 5): dedicated `waiver-stamp` ruleset, empirical commitlint detection, non-destructive caller-workflow drop, `.waiver-stamp.json` seeding, the instructions hand-off page, and the §4.13 file-PR-then-ruleset ordering. Completes the orchestrator. **E2E:** full flow from `setup-repository` to the hand-off page against a scratch repo.
- **PR N+1 — Cleanup refactor** (`cleanup-setup-automation` off PR 6): remove the now-dead `lockfile-honesty-checks` plumbing and any final stale narration. Pure removal, suite green before/after.

**Docs consistency rule (applied throughout):** no PR may leave `main` referencing something it removed or describing behavior it changed. Each PR revises README / `docs/auto-approval-setup.md` / `examples/` *to the extent it changes user-facing behavior* — not a full re-narration every time. PR 1 does a targeted input-removal fix; PR 2 does the caller rewrite; PRs 3–6 add the `waiver setup-repository` story as each capability lands; the cleanup PR sweeps only genuine residue.

Candidate prep for next time: if a future op needs more repo-config reads, the `gh`-shelling in PRs 3–6 will want a typed wrapper (`src/setup/gh.ts` is the seed) — grown as needed, not speculatively.

**Build-time verification (spec §7):** **V1** → PR 1 (does `GET /rules/branches/{branch}` need `administration:read`, or does `contents:read` suffice?). **V3** → PR 4 (localhost redirect accepted). **V4/V5** → PR 4 (org-secret resolution through `create-github-app-token`; `secrets: inherit` carries App scopes into the reusable reviewer — first exercised when secrets actually exist). Resolve each at the top of its PR; where the answer differs from the spec's conservative assumption, adjust that PR's tasks and note it in the PR body.

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
- Produces: `discoverRequiredChecks(octokit, owner, repo, base): Promise<string[]>` — reads the rules endpoint and classic protection and unions the results, `[]` if neither yields checks.
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
  it('unions in classic protection contexts when the rules endpoint yields none', async () => {
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
 * The required status-check contexts for `base` — the union of the rulesets endpoint and
 * classic branch protection; each surfaces only its own mechanism, so a repo may require
 * checks under either or both. The classic read needs `administration: read` (the App
 * token, spec §2.6); the rules read needs only `metadata: read`. Any read error is swallowed
 * to `[]`; an empty union is fail-closed upstream (no-op, never approve).
 */
export async function discoverRequiredChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
): Promise<string[]> {
  const [fromRules, fromClassic] = await Promise.all([
    readRules(octokit, owner, repo, base),
    readClassic(octokit, owner, repo, base),
  ]);
  return [...new Set([...fromRules, ...fromClassic])];
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

- [ ] **Step 11: Keep docs/examples consistent (targeted — this PR removed an input)**

This PR deletes the `lockfile-honesty-checks` action input, so nothing on `main` may still reference it, and the `ci-checks` list is no longer hand-maintained. Make the *minimal* edits that restore consistency (the full caller rewrite is PR 2 — do not do it here):

- `examples/waiver-stamp-review.yml`: delete the `lockfile-honesty-checks: ''` line and its comment block. Leave the rest of the template as-is (it still uses the old paste shape until PR 2).
- `docs/auto-approval-setup.md`: where it documents `lockfile-honesty-checks`, replace that with one line — the honesty check is now named via `.waiver-stamp.json`'s `lockfileHonestyCheck` field and picked up by autodiscovery. Where it documents hand-maintaining `ci-checks`, note that required checks are now auto-discovered and `ci-checks` is an empty-by-default override. Describe only the current behavior (no "previously you listed…" — no-archaeology).

Do not touch README here (no user-facing command changed yet). Run: `pnpm lint` (markdown/formatting) — no code impact.

- [ ] **Step 12: Rebuild the action, run everything**

Run: `pnpm build:action && pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS. Stage the regenerated `dist`.

- [ ] **Step 13: Commit + PR (skills)**

Stage `src/action/discover-checks.ts(.test)`, `src/action/resolve-checks.ts(.test)`, `src/engine/config.ts(.test)`, `schema/waiver-stamp-config.v0.schema.json`, `.github/actions/waiver-stamp-review/action.yml`, `src/action/main.ts`, `examples/waiver-stamp-review.yml`, `docs/auto-approval-setup.md`, the rebuilt `dist`. Branch `jordi/setup-automation/setup-automation-1` off the prep branch. PR body: PR 1 of the stack (depends on PR 0), notes the V1 finding.

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

## PR 3 — Preflight + orchestrator skeleton

**Intent:** ship `waiver setup-repository` as a runnable command that validates prerequisites and reports what it found and what remains — no repo mutation yet. This lands the CLI wiring, the `SetupError`→EXIT 2 mapping, and the orchestrator skeleton that PRs 4–6 grow one capability at a time. There is deliberately **no `--check` flag** (spec §4.1): this is simply the orchestrator's partial first version.

**Files:**
- Create: `src/setup/run.ts` — the real command-runner seam (execFile), injected everywhere `gh`/`git` is shelled
- Create: `src/setup/errors.ts` (+ implicitly tested via preflight)
- Create: `src/setup/preflight.ts`, `src/setup/preflight.test.ts`
- Create: `src/commands/setup-repository.ts`, `src/commands/setup-repository.test.ts`
- Modify: `src/cli.ts` — register `setup-repository`, add the `SetupError` branch to `run()`
- Modify: `.github/workflows/ci.yml` (or `cli.test.ts`) — smoke-test `setup-repository --help`

**Interfaces:**
- Produces: `runCommand(cmd, args, opts?): Promise<{ stdout: string; stderr: string; code: number }>` — the shell seam.
- Produces: `class SetupError extends Error { remediation: string }` — mapped to `EXIT.MALFORMED`.
- Produces: `preflight(cwd, deps): Promise<RepoContext>` where `RepoContext = { owner; repo; defaultBranch; pnpm }`.
- Produces: `setupRepository(opts, deps): Promise<void>` — the orchestrator; PR 3 body runs preflight and reports.

- [ ] **Step 1: Failing test for `preflight`**

Create `src/setup/preflight.test.ts` driving a fake runner (no real shell):

```ts
import { describe, expect, it, vi } from 'vitest';
import { SetupError } from './errors.ts';
import { preflight } from './preflight.ts';

function runner(map: Record<string, { stdout?: string; code?: number }>) {
  return vi.fn(async (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    const hit = Object.entries(map).find(([k]) => key.startsWith(k));
    if (!hit) throw new Error(`unexpected: ${key}`);
    return { stdout: hit[1].stdout ?? '', stderr: '', code: hit[1].code ?? 0 };
  });
}
const ok = {
  'git rev-parse --is-inside-work-tree': { stdout: 'true\n' },
  'git remote get-url origin': { stdout: 'https://github.com/jsalvata/demo.git\n' },
  'git symbolic-ref refs/remotes/origin/HEAD': { stdout: 'refs/remotes/origin/main\n' },
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
  it('parses an SSH origin remote', async () => {
    const r = await preflight('/repo', {
      run: runner({ ...ok, 'git remote get-url origin': { stdout: 'git@github.com:jsalvata/demo.git\n' } }),
      exists: async () => false,
    });
    expect(r).toMatchObject({ owner: 'jsalvata', repo: 'demo', pnpm: false });
  });
  it('throws SetupError with remediation when gh is unauthenticated', async () => {
    await expect(
      preflight('/repo', { run: runner({ ...ok, 'gh auth status': { code: 1 } }), exists: async () => false }),
    ).rejects.toBeInstanceOf(SetupError);
  });
});
```

Run: `pnpm test setup/preflight` → FAIL (modules not found).

- [ ] **Step 2: Implement `errors.ts`, `run.ts`, `preflight.ts`**

Create `src/setup/errors.ts`:

```ts
/** A preflight/setup failure carrying a user-facing remediation. Mapped to EXIT.MALFORMED (spec §4.12). */
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

Create `src/setup/run.ts`:

```ts
import { execFile } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Shell a command and capture its output. The single seam every `gh`/`git` caller injects, so
 * tests never touch a real shell. A non-zero exit is returned (not thrown) — callers decide what
 * a failure means. `input`, when set, is written to stdin (used for multiline pem → `gh secret set`).
 */
export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: opts.cwd }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ stdout, stderr, code });
    });
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}
```

Create `src/setup/preflight.ts`:

```ts
import { join } from 'node:path';
import { SetupError } from './errors.ts';
import type { RunResult } from './run.ts';

export interface PreflightDeps {
  run: (cmd: string, args: string[]) => Promise<RunResult>;
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

Run: `pnpm test setup/preflight` → PASS (3 cases).

- [ ] **Step 3: Failing test for the orchestrator skeleton**

Create `src/commands/setup-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { setupRepository } from './setup-repository.ts';

const ctx = { owner: 'jsalvata', repo: 'demo', defaultBranch: 'main', pnpm: true };

describe('setupRepository (skeleton)', () => {
  it('runs preflight and reports the resolved context', async () => {
    const info = vi.fn();
    await setupRepository({ cwd: '/repo' }, { preflight: vi.fn(async () => ctx), info, warn: vi.fn() });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('jsalvata/demo'));
  });
  it('warns when pnpm-lock is absent', async () => {
    const warn = vi.fn();
    await setupRepository(
      { cwd: '/repo' },
      { preflight: vi.fn(async () => ({ ...ctx, pnpm: false })), info: vi.fn(), warn },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pnpm-lock'));
  });
});
```

Run: `pnpm test setup-repository` → FAIL.

- [ ] **Step 4: Implement the skeleton orchestrator**

Create `src/commands/setup-repository.ts`. The `SetupDeps` interface starts minimal and gains fields in PRs 4–6; the skeleton only preflights and reports:

```ts
import { runCommand } from '../setup/run.ts';
import { access } from 'node:fs/promises';
import { preflight, type PreflightDeps, type RepoContext } from '../setup/preflight.ts';

export interface SetupOptions {
  yes?: boolean;
  target?: string;
  noApp?: boolean;
  cwd?: string;
}

export interface SetupDeps {
  preflight: (cwd: string, deps: PreflightDeps) => Promise<RepoContext>;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Default wiring for the CLI (real shell + fs). PRs 4–6 extend this with provisioning deps. */
export function makeSetupDeps(): SetupDeps {
  return {
    preflight: (cwd) =>
      preflight(cwd, {
        run: runCommand,
        exists: async (p) => access(p).then(() => true).catch(() => false),
      }),
    info: (m) => console.log(m),
    warn: (m) => console.warn(`warning: ${m}`),
  };
}

export async function setupRepository(opts: SetupOptions, deps: SetupDeps): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const ctx = await deps.preflight(cwd, undefined as never); // deps.preflight closes over its own run/exists
  deps.info(`waiver-stamp setup: ${ctx.owner}/${ctx.repo} (default branch ${ctx.defaultBranch})`);
  if (!ctx.pnpm)
    deps.warn('no pnpm-lock.yaml found — the dependency-bump op will be inert (spec §4.1).');
  deps.info('Preflight OK. Repo provisioning (App, secrets, ruleset, workflows) lands in the next releases; see docs/auto-approval-setup.md for the manual steps until then.');
}
```

(The test injects `deps.preflight` directly, so its second argument is unused there; the CLI's `makeSetupDeps` supplies the real closure. Adjust the signature to `preflight: (cwd: string) => Promise<RepoContext>` if cleaner — keep test and impl in sync.)

Run: `pnpm test setup-repository` → PASS.

- [ ] **Step 5: Wire the command into `cli.ts`**

Add to `src/cli.ts`:

```ts
import { makeSetupDeps, setupRepository } from './commands/setup-repository.ts';
import { SetupError } from './setup/errors.ts';
```

Register the command (after the `mcp` command):

```ts
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

Add a `SetupError` branch to `run()`'s catch, before the generic `else`:

```ts
    } else if (err instanceof SetupError) {
      console.error(`error: ${err.message}`);
      console.error(`  ${err.remediation}`);
      setExit(EXIT.MALFORMED);
    } else {
```

(commander maps `--no-app` to `opts.app === false`.)

- [ ] **Step 6: Smoke test + full checks**

Add to the CI `CLI smoke test` step (`.github/workflows/ci.yml`) or `src/cli.test.ts`: assert `node dist/cli.js setup-repository --help` exits 0 and mentions `--no-app`.

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 7: End-to-end**

Run `pnpm dev setup-repository` inside a real checkout with a GitHub `origin`. Expected: prints `waiver-stamp setup: <owner>/<repo> …`, the pnpm note if applicable, and the "provisioning lands next" line; exits 0. Failure modes surface as `SetupError` with remediation (e.g. run it outside a git tree → exit 2). Evidence: the terminal transcript.

- [ ] **Step 8: Commit + PR (skills)**

Branch `jordi/setup-automation/setup-automation-3` off PR 2. PR body: PR 3 of the stack; `waiver setup-repository` validate-and-report skeleton; no `--check` flag (spec §4.1); orchestrator grown in PRs 4–6.

---

## PR 4 — App provisioning (fresh path)

**Intent:** make `waiver setup-repository` actually create a per-adopter App and write its secrets. Lands the manifest builder, the loopback handshake, the install-target choice, the `gh` secrets wrapper, and the fresh-App resolution — wired into the orchestrator. **Excludes** reuse-existing-App and pem-on-disk (PR 5), to keep it bounded.

**Verify first:** **V3** (GitHub accepts an `http://127.0.0.1:<port>` `redirect_url` — Probot relies on it); **V4** (`gh secret set --org … --repos …` resolves for the reviewer identically to repo secrets); **V5** (the reusable reviewer from PR 2 mints an App token from the inherited secrets and it carries App scopes). Confirm each; adjust the loopback bind / secret argv / reusable reviewer token step if any differs.

**Files:**
- Create: `src/setup/manifest.ts` (+ test)
- Create: `src/setup/pages.ts`
- Create: `src/setup/loopback.ts` (+ test)
- Create: `src/setup/gh.ts` (+ test) — typed wrapper (orgs, secrets)
- Create: `src/setup/secrets.ts` (+ test)
- Create: `src/setup/provision-app.ts` (+ test) — target choice + fresh-App flow (reuse/disk stubbed to "fresh" this PR)
- Modify: `src/commands/setup-repository.ts` (+ test) — call provisioning after preflight
- Modify: `src/setup/open-browser.ts` — a `spawn`-based opener (macOS `open`, Linux `xdg-open`), injected

**Interfaces:**
- Produces: `appSlugName(owner): string`, `buildManifest({ owner, appUrl }): AppManifest`.
- Produces: `runManifestFlow(deps): Promise<{ appId; pem; slug }>`.
- Produces: `chooseTarget(preferred, gh): Promise<{ kind: 'personal' } | { kind: 'org'; org: string }>`.
- Produces: `provisionSecrets(gh, { target, appId, pem, owner, repo }): Promise<void>`.

- [ ] **Step 1: Failing tests for `manifest.ts`**

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
    expect(name.length).toBeLessThanOrEqual(34);
    expect(name.startsWith('waiver-stamp-')).toBe(true);
    expect(appSlugName('a'.repeat(60))).toBe(name); // deterministic
  });
});

describe('buildManifest', () => {
  it('carries the exact scopes and no events/webhook', () => {
    const m = buildManifest({ owner: 'jsalvata', appUrl: 'https://github.com/jsalvata/waiver-stamp' });
    expect(m.name).toBe('waiver-stamp-jsalvata');
    expect(m.public).toBe(false);
    expect(m.default_permissions).toEqual({ contents: 'write', pull_requests: 'write', administration: 'read' });
    expect(m.default_events).toEqual([]);
  });
});
```

Run: `pnpm test setup/manifest` → FAIL.

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

const NAME_CAP = 34; // GitHub App names must be ≤ 34 chars.

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

- [ ] **Step 3: Implement `pages.ts` (exercised via the loopback test)**

Create `src/setup/pages.ts`:

```ts
import type { AppManifest } from './manifest.ts';

/**
 * A self-submitting form that POSTs the manifest to GitHub's App-creation endpoint (the manifest
 * rides in a `manifest` field, so the flow requires a form POST). The loopback server serves it
 * and the browser submits it.
 */
export function formPage(action: string, manifest: AppManifest): string {
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
  return `<!doctype html><meta charset=utf-8><title>Create waiver-stamp App</title>
<body onload="document.forms[0].submit()">
<form action="${action}" method="post">
<input type="hidden" name="manifest" value='${json}'>
<noscript><button type="submit">Create the waiver-stamp GitHub App</button></noscript>
</form>`;
}

/** Shown after conversion succeeds; links the interactive install page (spec §3.3). */
export function donePage(installUrl: string): string {
  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — install</title>
<body><h1>App created ✓</h1><p>Last step: <a href="${installUrl}">install it on your repository</a>, then return to your terminal.</p>`;
}
```

- [ ] **Step 4: Failing test for `runManifestFlow`**

Create `src/setup/loopback.test.ts`:

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
    const openBrowser = vi.fn(async (formUrl: string) => {
      const u = new URL(formUrl);
      const page = await fetch(formUrl).then((r) => r.text());
      expect(page).toContain('method="post"');
      await fetch(`${u.origin}/callback?code=abc123&state=${u.searchParams.get('state')}`);
    });
    const creds = await runManifestFlow({
      target: { kind: 'personal' },
      manifest,
      openBrowser,
      convert,
    });
    expect(creds).toEqual({ appId: 42, pem: '-----BEGIN…', slug: 'waiver-stamp-o' });
    expect(convert).toHaveBeenCalledOnce();
  });

  it('rejects a callback whose state does not match (CSRF guard)', async () => {
    const manifest = buildManifest({ owner: 'o', appUrl: 'https://x' });
    const openBrowser = vi.fn(async (formUrl: string) => {
      await fetch(`${new URL(formUrl).origin}/callback?code=abc123&state=WRONG`);
    });
    await expect(
      runManifestFlow({ target: { kind: 'personal' }, manifest, openBrowser, convert: vi.fn(), timeoutMs: 2000 }),
    ).rejects.toThrow(/state/i);
  });
});
```

Run: `pnpm test setup/loopback` → FAIL.

- [ ] **Step 5: Implement `loopback.ts`**

Create `src/setup/loopback.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppManifest } from './manifest.ts';
import { donePage, formPage } from './pages.ts';

export interface ManifestFlowDeps {
  target: { kind: 'personal' } | { kind: 'org'; org: string };
  manifest: AppManifest;
  openBrowser: (url: string) => Promise<void>;
  convert: (code: string) => Promise<{ appId: number; pem: string; slug: string }>;
  timeoutMs?: number;
}

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
    let port = 0;
    let settled = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/') {
        const manifest = { ...deps.manifest, redirect_url: `http://127.0.0.1:${port}/callback` };
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(formPage(createAction(deps.target), manifest));
        return;
      }
      if (url.pathname === '/callback') {
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400).end('state mismatch');
          return finish(new Error('manifest flow: state mismatch (possible CSRF) — aborting'));
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400).end('missing code');
          return finish(new Error('manifest flow: no code in callback'));
        }
        deps.convert(code).then(
          (creds) => {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(donePage(`https://github.com/apps/${creds.slug}/installations/new`));
            finish(null, creds);
          },
          (err) => {
            res.writeHead(500).end('conversion failed');
            finish(err instanceof Error ? err : new Error(String(err)));
          },
        );
        return;
      }
      res.writeHead(404).end();
    });

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

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      deps.openBrowser(`http://127.0.0.1:${port}/?state=${state}`).catch(finish);
    });
  });
}
```

Run: `pnpm test setup/loopback` → PASS.

- [ ] **Step 6: `gh.ts` wrapper (failing test → impl)**

Create `src/setup/gh.test.ts` + `src/setup/gh.ts`. A typed thin wrapper over the injected `run` seam. This PR needs `listOrgs()`, `setSecret({ scope, name, value, repo?, org?, repos? })`, and `appConversion(code)` (POST `/app-manifests/{code}/conversions` via `gh api`). Each method builds `gh` argv and parses JSON stdout; the test asserts the exact argv and stdin (pem via `--input -`/stdin, never argv). Sketch:

```ts
export interface GhClient {
  listOrgs(): Promise<string[]>;
  setSecret(a: { name: string; value: string; scope: 'repo' | 'org'; repo?: string; org?: string; repos?: string[] }): Promise<void>;
  appConversion(code: string): Promise<{ appId: number; pem: string; slug: string }>;
}

export function makeGh(run: (cmd: string, args: string[], opts?: { input?: string }) => Promise<RunResult>): GhClient {
  return {
    async listOrgs() {
      const r = await run('gh', ['api', 'user/orgs', '--jq', '.[].login']);
      return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    },
    async setSecret(a) {
      const args = ['secret', 'set', a.name];
      if (a.scope === 'org') args.push('--org', a.org!, '--repos', (a.repos ?? [a.repo!]).join(','));
      else args.push('--repo', a.repo!);
      args.push('--body', '-'); // read value from stdin
      const r = await run('gh', args, { input: a.value });
      if (r.code !== 0) throw new SetupError(`failed to set secret ${a.name}`, r.stderr.trim());
    },
    async appConversion(code) {
      const r = await run('gh', ['api', '-X', 'POST', `/app-manifests/${code}/conversions`]);
      const j = JSON.parse(r.stdout) as { id: number; pem: string; slug: string };
      return { appId: j.id, pem: j.pem, slug: j.slug };
    },
  };
}
```

Run: `pnpm test setup/gh` → PASS. *(Adjust `--body -` vs `< file` per the installed `gh` version's stdin handling at build time.)*

- [ ] **Step 7: `provision-app.ts` — target choice + fresh flow (failing test → impl)**

Create `src/setup/provision-app.test.ts` + `src/setup/provision-app.ts`:
- `chooseTarget(preferred, gh)` — if `preferred` is `'personal'` or an org login, use it; else (interactive) offer personal + `gh.listOrgs()`, org recommended (spec §4.2, D9). For the non-interactive test, pass `preferred` and assert the resolved target.
- `provisionAppFresh({ target, owner, gh, openBrowser })` — build the manifest, `runManifestFlow` with `convert: gh.appConversion`, return `{ appId, pem, slug }`. (Reuse/disk are **not** consulted this PR — PR 5 wraps this.)

Test asserts: chooseTarget maps `--target myorg` → `{ kind: 'org', org: 'myorg' }`; provisionAppFresh calls `runManifestFlow` and returns the converted creds (inject a fake flow).

Run: `pnpm test setup/provision-app` → PASS.

- [ ] **Step 8: `secrets.ts` (failing test → impl)**

Create `src/setup/secrets.test.ts` + `src/setup/secrets.ts`:

```ts
import type { GhClient } from './gh.ts';

/** Write the two conventional reviewer secrets at the chosen scope. Idempotent; touches no others. */
export async function provisionSecrets(
  gh: GhClient,
  a: { target: { kind: 'personal' } | { kind: 'org'; org: string }; appId: number; pem: string; owner: string; repo: string },
): Promise<void> {
  const common = a.target.kind === 'org'
    ? { scope: 'org' as const, org: a.target.org, repos: [`${a.owner}/${a.repo}`] }
    : { scope: 'repo' as const, repo: `${a.owner}/${a.repo}` };
  await gh.setSecret({ name: 'WAIVER_STAMP_APP_ID', value: String(a.appId), ...common });
  await gh.setSecret({ name: 'WAIVER_STAMP_APP_PRIVATE_KEY', value: a.pem, ...common });
}
```

Test (fake `GhClient`): org target → two `setSecret` calls with `scope: 'org'`; personal → `scope: 'repo'`; asserts exactly those two names, never a third.

Run: `pnpm test setup/secrets` → PASS.

- [ ] **Step 9: `open-browser.ts` + wire provisioning into the orchestrator**

Create `src/setup/open-browser.ts`: `openBrowser(url)` spawning the platform opener (`open` on darwin, `xdg-open` else), falling back to printing the URL. Inject via `makeSetupDeps`.

Extend `SetupDeps` and `setupRepository` (`src/commands/setup-repository.ts`): after preflight, unless `opts.noApp`, run `chooseTarget` → `provisionAppFresh` → `provisionSecrets`, then `openBrowser(installUrl)`. Update `makeSetupDeps` to supply `gh: makeGh(runCommand)`, `provisionAppFresh`, `provisionSecrets`, `chooseTarget`, `openBrowser`. Update `setup-repository.test.ts` to inject fakes and assert: `--no-app` skips provisioning; the happy path calls `provisionSecrets` once and opens the install URL.

```ts
// added to setupRepository, after the preflight report:
if (!opts.noApp) {
  const target = await deps.chooseTarget(opts.target, deps.gh);
  const app = await deps.provisionAppFresh({ target, owner: ctx.owner, gh: deps.gh, openBrowser: deps.openBrowser });
  await deps.provisionSecrets(deps.gh, { target, appId: app.appId, pem: app.pem, owner: ctx.owner, repo: ctx.repo });
  deps.info(`App ${app.slug} created; secrets written.`);
  await deps.openBrowser(`https://github.com/apps/${app.slug}/installations/new`);
} else {
  deps.info('--no-app: skipping App provisioning (configure the human-click layer manually).');
}
```

Run: `pnpm test setup-repository setup/secrets setup/provision-app` → PASS.

- [ ] **Step 10: Docs (targeted) + full checks**

Update `README.md` / `docs/auto-approval-setup.md` to note `waiver setup-repository` now provisions the App and secrets automatically (the create + install clicks stay manual, §3.3). Describe current behavior only.

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 11: End-to-end (with the two clicks)**

Against a real test account/repo, run `pnpm dev setup-repository --target personal`. Click **Create GitHub App** in the browser; confirm the loopback captures the code, conversion returns the pem, and `gh secret list` shows `WAIVER_STAMP_APP_ID` + `WAIVER_STAMP_APP_PRIVATE_KEY`. The install page opens. Evidence: `gh secret list` output + the created App. (The clicks can't be automated — §3.3.)

- [ ] **Step 12: Commit + PR (skills)**

Branch `jordi/setup-automation/setup-automation-4` off PR 3. PR body: PR 4 of the stack; fresh-App provisioning wired end-to-end; excludes reuse/disk (PR 5); records V3/V4/V5 findings.

---

## PR 5 — App reuse + pem-on-disk

**Intent:** the idempotent / multi-repo layer over PR 4's fresh path — so a second repo under the same owner doesn't re-mint. Reuse an already-installed **org** App with no pem needed (org secrets already carry it, §4.3); offer **personal** pem-on-disk persistence and reuse (§4.4). Wraps `provisionAppFresh` behind a `resolveApp` that consults reuse → disk → fresh in order.

**Files:**
- Create: `src/setup/disk.ts` (+ test) — read/write `~/.waiver-install/<owner>.json` at `chmod 600`
- Create: `src/setup/resolve-app.ts` (+ test) — the §4.3 resolution order
- Modify: `src/setup/gh.ts` (+ test) — add `appExists(owner, slug)` / `orgSecretsPresent(org)` reads
- Modify: `src/commands/setup-repository.ts` (+ test) — call `resolveApp` instead of `provisionAppFresh`; secrets only written when a pem is present

**Interfaces:**
- Produces: `readDiskApp(owner): Promise<{ appId; pem } | null>`, `writeDiskApp(owner, { appId, pem }): Promise<void>` (dir `700`, file `600`).
- Produces: `resolveApp(deps): Promise<{ slug; appId?; pem?; source: 'reuse-org' | 'disk' | 'fresh' }>`.

- [ ] **Step 1: `disk.ts` (failing test → impl)**

Create `src/setup/disk.test.ts` + `src/setup/disk.ts`. Test in a tmp `HOME`: `writeDiskApp` then `readDiskApp` round-trips; the file is `0600` and the dir `0700`; a missing file → `null`; never called for org targets (enforced by the caller, asserted in resolve-app). Warn (return a flag) that a private key is on disk.

Run: `pnpm test setup/disk` → PASS.

- [ ] **Step 2: `resolveApp` (failing test → impl)**

Create `src/setup/resolve-app.test.ts` covering §4.3:
- **org, App exists + org secrets present** → `{ source: 'reuse-org', slug }`, no pem, no manifest flow.
- **personal, disk file present** → `{ source: 'disk', appId, pem }`, no manifest flow.
- **personal, no disk, opts to save** → runs `provisionAppFresh`, then `writeDiskApp`; `{ source: 'fresh' }`.
- **personal, no disk, declines save** → fresh, no disk write.

Inject `provisionAppFresh`, disk fns, and `gh`. Implement `resolve-app.ts` as the ordered resolver.

Run: `pnpm test setup/resolve-app` → PASS.

- [ ] **Step 3: Swap the orchestrator to `resolveApp`; secrets gated on a pem**

In `src/commands/setup-repository.ts`, replace the `provisionAppFresh` call with `deps.resolveApp({ target, owner, gh, openBrowser, saveToDisk })`. Only call `provisionSecrets` when `app.pem` is present (reuse-org path already has org secrets — spec §4.3). Update the test: reuse-org path writes no secrets; fresh/disk path writes them.

Run: `pnpm test setup-repository` → PASS.

- [ ] **Step 4: Docs (targeted) + full checks + E2E**

Doc the reuse/disk options in `docs/auto-approval-setup.md` (§4.3–4.4). Run `pnpm build && pnpm test && pnpm typecheck && pnpm lint`. E2E: run `setup-repository` twice on two repos under one org → second run reports `reuse-org`, writes no new App; and once personal with save → the second personal repo loads the disk key.

- [ ] **Step 5: Commit + PR (skills)**

Branch `jordi/setup-automation/setup-automation-5` off PR 4. PR body: PR 5 of the stack; reuse + pem-on-disk on top of the fresh path.

---

## PR 6 — Repo config + phase boundary

**Intent:** everything the App doesn't cover — the dedicated ruleset, commitlint detection, the non-destructive caller-workflow drop, `.waiver-stamp.json` seeding, the instructions hand-off page — plus the §4.13 ordering (open the workflows PR, let the producer run once, *then* add the required-check ruleset). Completes the orchestrator.

**Files:**
- Create: `src/setup/ruleset.ts` (+ test)
- Create: `src/setup/commitlint.ts` (+ test)
- Create: `src/setup/workflows.ts` (+ test)
- Create: `src/setup/config-seed.ts` (+ test)
- Create: `src/setup/handoff.ts` (+ test)
- Modify: `src/setup/gh.ts` (+ test) — add `listRulesets`, `createRuleset`, `installationPresent(owner, repo)`, `checkRunPresent(owner, repo, sha, name)`
- Modify: `src/commands/setup-repository.ts` (+ test) — the full phased flow
- Modify: `README.md` — finalize the happy path

**Interfaces:**
- Produces: `ensureWaiverStampRuleset(gh, { owner, repo, defaultBranch }): Promise<'created' | 'exists'>`.
- Produces: `detectCommitlintBodyLimit(cwd, run): Promise<{ blocks: boolean }>`.
- Produces: `discoverCiWorkflowNames(dir): Promise<string[]>`, `detectLockfileHonestyCheck(dir): Promise<string | null>`, `writeCallerWorkflows(cwd, { ciWorkflowNames }): Promise<{ written: string[]; skipped: string[] }>`.
- Produces: `seedConfigIfAbsent(cwd, { lockfileHonestyCheck? }): Promise<{ seeded: boolean; existing: boolean }>`.
- Produces: `handoffPage(args): string`.

- [ ] **Step 1: `ensureWaiverStampRuleset` (failing test → impl)**

Create `src/setup/ruleset.test.ts` + `src/setup/ruleset.ts` (dedicated `waiver-stamp` ruleset requiring only the `waiver-stamp` check; idempotent — existing → `'exists'`):

```ts
import type { GhClient } from './gh.ts';

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

Test both branches against a fake `gh`. Run: `pnpm test setup/ruleset` → PASS.

- [ ] **Step 2: `detectCommitlintBodyLimit` (failing test → impl)**

Create `src/setup/commitlint.test.ts` + `src/setup/commitlint.ts`. Run the repo's `commit-msg` hook (or `npx commitlint`) against a synthetic >100-char-body message, read the exit code, return `{ blocks }`. **Warn**, never edit their config (§4.7). Inject `run`; test reject → `{ blocks: true }`, pass → `{ blocks: false }`. *(This repo's own `commitlint.config.js` sets `body-max-line-length: [0]`, so an integration self-run returns `blocks: false`.)*

Run: `pnpm test setup/commitlint` → PASS.

- [ ] **Step 3: `workflows.ts` — discovery + non-destructive write (failing test → impl)**

Create `src/setup/workflows.test.ts` + `src/setup/workflows.ts`:
- `discoverCiWorkflowNames(dir)` — read `.github/workflows/*.yml` `name:` fields, skipping our own `waiver-stamp-*`.
- `detectLockfileHonestyCheck(dir)` — find a job using the `lockfile-assay` action/package; return its job/check name or `null`.
- `writeCallerWorkflows(cwd, { ciWorkflowNames })` — write `waiver-stamp-ci.yml` + `waiver-stamp-review.yml` from the PR-2 caller templates with `workflows:` filled; **skip (do not overwrite) any path that exists**, recording it in `skipped[]`. Return `{ written, skipped }`.

Test with a scaffolded `.github/workflows/` fixture (a `CI` workflow + a `lockfile-assay` job): discovery returns `['CI']` + the honesty name; first write writes both, second call skips both.

Run: `pnpm test setup/workflows` → PASS.

- [ ] **Step 4: `config-seed.ts` (failing test → impl)**

Create `src/setup/config-seed.test.ts` + `src/setup/config-seed.ts`. `seedConfigIfAbsent(cwd, { lockfileHonestyCheck })`: absent → write the closed-by-default template (README `changeDocs.allow/deny`, `allowBumping: []`, plus `lockfileHonestyCheck` if given); present → no-op, return `{ seeded: false, existing: true }`. Never widen an existing policy (§4.11).

Run: `pnpm test setup/config-seed` → PASS.

- [ ] **Step 5: `handoff.ts` (failing test → impl)**

Create `src/setup/handoff.test.ts` + `src/setup/handoff.ts`. `handoffPage({ owner, repo, slug, defaultBranch, installDetected, configExisted, suggestedHonestyCheck })` → instructions-only HTML (§4.10): confirm install (if not detected); review `.waiver-stamp.json` (+ the suggested `lockfileHonestyCheck` edit when `configExisted` and a check was detected); set merge/rebase (not squash); optional `.github/**` protection — terse imperatives, interpolated slug/repo/branch, one link to `docs/auto-approval-setup.md` at the bottom, no rationale. Test the interpolation and the conditional lines.

Run: `pnpm test setup/handoff` → PASS.

- [ ] **Step 6: Full phased orchestrator (failing test → impl)**

Extend `src/commands/setup-repository.test.ts` for the §4.13 ordering: caller workflows are written **before** the ruleset; the ruleset is gated on the `waiver-stamp` check existing (`gh.checkRunPresent`). Cover: check absent → prints the "merge the PR, then re-run" message and creates **no** ruleset (exit 0); check present → creates the ruleset; re-run with an existing ruleset → `'exists'` no-op; `--no-app` still does the config/workflow half.

Implement the full flow in `setup-repository.ts`:

```ts
// after provisioning (PRs 4–5):
const wf = join(cwd, '.github/workflows');
const ciNames = await deps.discoverCiWorkflowNames(wf);
const honesty = await deps.detectLockfileHonestyCheck(wf);
const drop = await deps.writeCallerWorkflows(cwd, { ciWorkflowNames: ciNames });
for (const p of drop.skipped) deps.warn(`left existing ${p} untouched — reconcile by hand.`);
const seed = await deps.seedConfigIfAbsent(cwd, { lockfileHonestyCheck: honesty ?? undefined });
if ((await deps.detectCommitlintBodyLimit(cwd)).blocks)
  deps.warn('commitlint rejects long body lines; set `body-max-line-length: [0]` (spec §4.7).');

// §4.13 phase boundary: the required-check ruleset must not precede the producer's first run.
if (await deps.gh.checkRunPresent(ctx.owner, ctx.repo, /* latest default-branch sha */)) {
  const r = await deps.ensureWaiverStampRuleset(deps.gh, ctx);
  deps.info(`waiver-stamp ruleset ${r}.`);
} else {
  deps.info('Merge the workflows PR (or push the callers) so the waiver-stamp check runs once, then re-run `waiver setup-repository` to add the required-check ruleset.');
}

const installed = await deps.gh.installationPresent(ctx.owner, ctx.repo).catch(() => false);
await deps.openBrowser(
  deps.handoffPage({
    owner: ctx.owner, repo: ctx.repo, slug, defaultBranch: ctx.defaultBranch,
    installDetected: installed, configExisted: seed.existing, suggestedHonestyCheck: seed.existing ? honesty : null,
  }),
);
```

Run: `pnpm test setup-repository` → PASS.

- [ ] **Step 7: README finalize + full checks**

Point README's happy path at `waiver setup-repository` with the manual doc linked (§2.8). Describe current behavior only. Run: `pnpm build && pnpm test && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 8: End-to-end (full flow)**

Against a scratch repo: `pnpm dev setup-repository`. Confirm — callers written (skipped on re-run), config seeded if absent, commitlint warning if applicable, the phase-boundary message before the producer has run, and the hand-off page opens. After merging the callers and letting the producer run, re-run → the ruleset is created and the run converges to a no-op. Evidence: the written files, the created ruleset (`gh api …/rulesets`), the hand-off page.

- [ ] **Step 9: Commit + PR (skills)**

Branch `jordi/setup-automation/setup-automation-6` off PR 5. PR body: PR 6 of the stack; repo config + §4.13 phase boundary; completes the orchestrator.

---

## PR N+1 — Cleanup refactor

**Intent:** remove the residue the feature left behind. Pure removal — suite green before and after, no behavior change.

**Files:**
- Modify: `src/action/main.ts` (drop the vestigial `lockfileHonestyChecks` from the ncc `inputs`)
- Modify: `src/action/resolve-checks.ts` (drop `lockfileHonestyChecks` from the factory's parameter type)
- Modify: `src/action/resolve-checks.test.ts` (constructors pass `{ ciChecks }` only)
- Modify: `docs/auto-approval-setup.md` / `examples/` — any final stale narration the per-PR fixes missed

- [ ] **Step 1: Remove the vestigial honesty-list plumbing**

In `src/action/resolve-checks.ts`, change the factory parameter from `{ ciChecks: string[]; lockfileHonestyChecks: string[] }` to `{ ciChecks: string[] }`. In `src/action/main.ts` ncc entry, `inputs` becomes `{ ciChecks: parseList(core.getInput('ci-checks')) }`. Update any test constructing the factory to pass `{ ciChecks: [...] }` only.

- [ ] **Step 2: Run the suite (green — the field was already unread since PR 1)**

Run: `pnpm build:action && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. Stage the rebuilt `dist`.

- [ ] **Step 3: Final doc sweep (residue only)**

With the per-PR consistency rule, most stale narration is already gone. Scan `docs/auto-approval-setup.md` and `examples/` for any remaining reference to a hand-maintained `ci-checks` list or `lockfile-honesty-checks`; delete it, describing only what is (no-archaeology). Keep the one-line note that `ci-checks` is an empty-by-default override for the no-App path.

- [ ] **Step 4: Repo checks + commit + PR (skills)**

Run: `pnpm test && pnpm lint`. Branch `jordi/setup-automation/cleanup-setup-automation` off PR 6. PR body: cleanup PR (N+1); pure removal of dead honesty-list plumbing and any stale doc residue.

---

## Self-review notes

- **Spec coverage:** §2.1 → PR 2; §2.2–2.3 → PR 2 (trigger model) + PR 0/1 (backstop unchanged); §2.4 → PR 1; §2.5 → PR 1 (config field + fail-safe match); §2.6 → PR 1 (App token via the action's `github-token`) + PR 4 manifest scope; §2.7 → PR 1 (`ci-checks` override kept); §2.8 → PRs 2/4/6 docs; §3 → PR 4 (manifest + loopback + the two clicks); §4.1 → PR 3 (preflight); §4.2 → PR 4 (`chooseTarget`); §4.3–4.4 → PR 5 (`resolveApp`, disk); §4.5 → PR 4 (`secrets`); §4.6 → PR 6 (`ruleset`); §4.7 → PR 6 (`commitlint`); §4.8 → PR 6 (`workflows`); §4.9 → PR 4/6 (install browser hand-off); §4.10 → PR 6 (`handoff`); §4.11 → PR 6 (`config-seed`); §4.12 → PR 3 (CLI wiring + `SetupError`→EXIT 2); §4.13 → PR 6 (phase boundary); §8 → the resliced PR stack.
- **Verification gates:** V1 (PR 1), V3/V4/V5 (PR 4) each resolved at the top of their PR; the spec's conservative assumption is the default and the PR body records any deviation.
- **Type consistency:** `ResolvedChecks` / `makeResolveRequiredChecks` signatures match between PR 0 and PR 1; `discoverRequiredChecks` is stable; the self-exclusion constant is the single literal `'waiver-stamp'`; the secret names are the two literals `WAIVER_STAMP_APP_ID` / `WAIVER_STAMP_APP_PRIVATE_KEY` throughout; `RepoContext` / `GhClient` / `SetupDeps` are introduced in PR 3 and only *extended* (never reshaped) by PRs 4–6.
- **Orchestrator growth:** `src/commands/setup-repository.ts` and its test are touched by PRs 3, 4, 5, 6 — each adds one runnable capability and its wiring, keeping every intermediate `main` state shippable and end-to-end testable.
- **Naming caution:** PR 2 names the reusable workflows `reusable-ci.yml` / `reusable-review.yml` to avoid colliding with this repo's existing `ci.yml`; the spec's §2.1 example `uses:` refs (`…/ci.yml@vX`) are updated to the `reusable-*` paths — flag this in the PR 2 body since the spec text says `ci.yml`.
