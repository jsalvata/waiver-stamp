# Autodiscovery end-to-end test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live-API integration suite that guards check autodiscovery — the real `resolve → discover` chain plus both protection mechanisms — so the class of bug that shipped in PR 1 (a SHA fed to a branch-name endpoint) can't recur silently.

**Architecture:** A new `*.integration.test.ts` that calls the real reviewer code (`makeResolvePr`, `discoverRequiredChecks`) against live GitHub, excluded from the offline `pnpm test` and run by a new `pnpm test:integration`. A dedicated CI job runs it on PRs. Each of the three checks self-skips when its token / context isn't present. Design: `docs/superpowers/specs/2026-07-19-autodiscovery-e2e-design.md`.

**Tech Stack:** vitest 2.1 (`it.skipIf`), `@actions/github` `getOctokit`, GitHub REST (rules + classic branch-protection endpoints), GitHub Actions.

## Global Constraints

- Node `>=24`; pnpm `9.12.0`. ESM, relative imports carry `.ts`. Biome style (single quotes, semicolons, trailing commas, 100-col).
- The integration suite must be **excluded from `pnpm test`** (the unit run stays offline and fast) and run only by `pnpm test:integration`.
- Token roles (spec §Components): checks A/B use `GITHUB_TOKEN` (the rules endpoint needs only metadata; this repo is public); check C uses `WAIVER_E2E_ADMIN_TOKEN` — **any** token with `administration: read` on the classic target, NOT the reviewer App secrets. Each check `it.skipIf`s when its input is absent.
- Known live facts asserted: `jsalvata/waiver-stamp` `main` requires the ruleset check `lockfile-assay`; `mixmaxhq/monorepo-experimental` `main` has non-empty classic required checks. Assertions are resilient — `toContain` for our repo, non-emptiness for the third-party repo.
- `makeResolvePr(octokit)(owner, repo, headSha)` returns `{ number: number; base: string; baseRef: string } | null` where `base` is the base **SHA** and `baseRef` is the base **branch name** (post-PR-1 fix). A base **SHA** (40 hex) must never be passed to `discoverRequiredChecks` — it takes a branch name.
- No AI attribution in commits; never `--no-verify`. Conventional-commit prefixes.

**No prep/cleanup refactor:** self-contained new test + config + CI; nothing existing fights it.

---

## Task 1: Live-API integration suite + vitest wiring

**Files:**
- Create: `src/action/discover-checks.integration.test.ts`
- Create: `vitest.integration.config.ts`
- Modify: `vitest.config.ts` (exclude `*.integration.test.ts` from the default run)
- Modify: `package.json` (add the `test:integration` script)

**Interfaces:**
- Consumes: `makeResolvePr` from `src/action/adapters.ts` (`(octokit) => (owner, repo, headSha) => Promise<{ number; base; baseRef } | null>`); `discoverRequiredChecks` from `src/action/discover-checks.ts` (`(octokit, owner, repo, base) => Promise<string[]>`); `getOctokit` from `@actions/github`.
- Produces: the `test:integration` script (consumed by Task 2's CI job).

- [ ] **Step 1: Write the integration suite**

Create `src/action/discover-checks.integration.test.ts`:

```ts
import { getOctokit } from '@actions/github';
import { describe, expect, it } from 'vitest';
import { makeResolvePr } from './adapters.ts';
import { discoverRequiredChecks } from './discover-checks.ts';

// Live-API suite (excluded from `pnpm test`; run via `pnpm test:integration`). Each check
// self-skips when its token / context is absent. See docs/superpowers/specs/2026-07-19-autodiscovery-e2e-design.md.
const GH_TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_TOKEN = process.env.WAIVER_E2E_ADMIN_TOKEN;
const HEAD_SHA = process.env.WAIVER_E2E_HEAD_SHA;
const SHA_RE = /^[0-9a-f]{40}$/;

describe('autodiscovery — live GitHub API', () => {
  // Check B — rules endpoint on this (public) repo. Confirms the real read + parse.
  it.skipIf(!GH_TOKEN)('discovers this repo\'s ruleset required checks (check B)', async () => {
    const octokit = getOctokit(GH_TOKEN as string);
    const checks = await discoverRequiredChecks(octokit, 'jsalvata', 'waiver-stamp', 'main');
    expect(checks).toContain('lockfile-assay');
  });

  // Check A — the full resolve→discover chain, the regression the PR-1 bug needed. Feeding the
  // base SHA to the branch-name endpoint (the bug) returns [] and fails the lockfile-assay assertion;
  // a ref/SHA swap fails the field-shape assertions.
  it.skipIf(!GH_TOKEN || !HEAD_SHA)(
    'resolves the PR base as a ref (not a SHA) and discovers its checks (check A)',
    async () => {
      const octokit = getOctokit(GH_TOKEN as string);
      const pr = await makeResolvePr(octokit)('jsalvata', 'waiver-stamp', HEAD_SHA as string);
      expect(pr).not.toBeNull();
      expect(pr?.baseRef).not.toMatch(SHA_RE); // a branch name, e.g. "main"
      expect(pr?.base).toMatch(SHA_RE); // a 40-hex SHA
      const checks = await discoverRequiredChecks(octokit, 'jsalvata', 'waiver-stamp', pr!.baseRef);
      if (pr?.baseRef === 'main') expect(checks).toContain('lockfile-assay');
    },
  );

  // Check C — classic endpoint + admin scope, against a known classic-protected repo. Admin-gated.
  it.skipIf(!ADMIN_TOKEN)(
    'discovers a classic-protected repo\'s required checks with an admin token (check C)',
    async () => {
      const octokit = getOctokit(ADMIN_TOKEN as string);
      const checks = await discoverRequiredChecks(octokit, 'mixmaxhq', 'monorepo-experimental', 'main');
      expect(checks.length).toBeGreaterThan(0);
    },
  );
});
```

- [ ] **Step 2: Add the integration vitest config**

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
  },
});
```

- [ ] **Step 3: Exclude integration tests from the default run**

The default config's `include: ['src/**/*.test.ts']` also matches `*.integration.test.ts`, so exclude them (preserving vitest's built-in excludes). Rewrite `vitest.config.ts`:

```ts
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
  },
});
```

- [ ] **Step 4: Add the `test:integration` script**

In `package.json` `scripts`, add after `"test:watch"`:

```json
    "test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 5: Verify the default unit run EXCLUDES the integration suite**

Run: `pnpm test`
Expected: PASS, and the run does **not** include `discover-checks.integration.test.ts` (grep the output). Confirm with:
`pnpm test 2>&1 | grep -c integration` → Expected: `0`.

- [ ] **Step 6: Verify the integration suite runs, and checks self-skip correctly**

Run (no tokens set): `env -u GITHUB_TOKEN -u WAIVER_E2E_ADMIN_TOKEN -u WAIVER_E2E_HEAD_SHA pnpm test:integration`
Expected: PASS with all three checks reported **skipped** (0 failures).

Run (real token, check B live): `GITHUB_TOKEN="$(gh auth token)" pnpm test:integration`
Expected: check B **passes** (returns `lockfile-assay` from the real rules endpoint); A skipped (no `WAIVER_E2E_HEAD_SHA`); C skipped (no admin token) unless your `gh` token is also set as `WAIVER_E2E_ADMIN_TOKEN`.

Run (exercise check C locally): `WAIVER_E2E_ADMIN_TOKEN="$(gh auth token)" pnpm test:integration`
Expected: check C **passes** (non-empty classic checks from `monorepo-experimental`), if your `gh` account can admin-read that repo. If it can't, the check errors — that itself confirms the admin-scope requirement; note it and move on (check C is designed for a token that can).

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (`getOctokit` typing: `GH_TOKEN as string` inside the `skipIf`-guarded body is fine.)

- [ ] **Step 8: Commit**

```bash
git add src/action/discover-checks.integration.test.ts vitest.integration.config.ts vitest.config.ts package.json
git commit -m "test: add live-api autodiscovery integration suite"
```

---

## Task 2: CI job running the integration suite

**Files:**
- Modify: `.github/workflows/ci.yml` (add a dedicated `autodiscovery-e2e` job)

**Interfaces:**
- Consumes: the `test:integration` script (Task 1).

- [ ] **Step 1: Add the dedicated CI job**

Append a new job to `.github/workflows/ci.yml` `jobs:` (sibling to `build` and `waiver-stamp`). It is deliberately separate from the unit `build` job so live-API flakiness can't block the unit gate:

```yaml
  autodiscovery-e2e:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Live-API autodiscovery integration suite
        run: pnpm test:integration
        env:
          # Default token: metadata reads the rules endpoint; pull-requests:read resolves the PR.
          # No admin token here, so the classic check (C) self-skips until a WAIVER_E2E_ADMIN_TOKEN
          # secret is provisioned.
          GITHUB_TOKEN: ${{ github.token }}
          WAIVER_E2E_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
```

- [ ] **Step 2: Lint the workflow**

Run: `pnpm dlx actionlint .github/workflows/ci.yml` (the repo runs `actionlint` in CI via `.github/workflows/actionlint.yml`).
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the autodiscovery integration suite on PRs"
```

- [ ] **Step 4: Behavioral verification on the PR**

After opening the PR (below), confirm on GitHub: the `autodiscovery-e2e` job runs, check B passes (finds `lockfile-assay`) and check A passes (its own PR's base is `main`; asserts a ref-not-SHA base and finds `lockfile-assay`). Evidence: the green job + its log showing checks A/B ran and C skipped. This is the real proof the suite works end-to-end — and that autodiscovery works against live GitHub through the resolve seam.

---

## Branch & PR

- Branch: `jsalvata/setup-automation/autodiscovery-e2e` off `main` (already created).
- After both tasks: open a **ready-for-review** PR (this repo's `no-draft-prs` preference) via the git-pull-request skill. Body: standalone early increment guarding autodiscovery with a live-API suite; note the layering (full `workflow_run` harness deferred to PR 2) and that check C stays skipped in CI until a `WAIVER_E2E_ADMIN_TOKEN` secret is added.

---

## Self-review

- **Spec coverage:** Check A → Task 1 Step 1 (resolve→discover chain, ref-not-SHA guard); Check B → Step 1 (rules endpoint, this repo); Check C → Step 1 (classic, admin-gated); vitest exclusion + `test:integration` → Steps 2–4; CI job with `WAIVER_E2E_HEAD_SHA` → Task 2; token roles + self-skip → the `skipIf` guards and Global Constraints; "not now" (sandbox repo, workflow harness) → excluded by construction.
- **Type consistency:** `makeResolvePr` return `{ number; base; baseRef }` matches its PR-1 signature; `discoverRequiredChecks(octokit, owner, repo, base)` takes a branch name — the suite always passes a ref (`'main'` or `pr.baseRef`), never a SHA; `getOctokit(token)` is the `@actions/github` factory already used by the ncc entry.
- **Placeholder scan:** none — all code and commands are concrete.
- **One deviation from the design doc, noted:** checks A/B gate on `GITHUB_TOKEN` presence rather than falling back to an unauthenticated Octokit (`getOctokit` needs a token; CI always provides `github.token`, and local runs use `$(gh auth token)`). Same coverage, simpler.
