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
  it.skipIf(!GH_TOKEN)("discovers this repo's ruleset required checks (check B)", async () => {
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
      if (!pr) throw new Error('expected an open PR for WAIVER_E2E_HEAD_SHA');
      expect(pr.baseRef).not.toMatch(SHA_RE); // a branch name, e.g. "main"
      expect(pr.base).toMatch(SHA_RE); // a 40-hex SHA
      const checks = await discoverRequiredChecks(octokit, 'jsalvata', 'waiver-stamp', pr.baseRef);
      if (pr.baseRef === 'main') expect(checks).toContain('lockfile-assay');
    },
  );

  // Check C — classic endpoint + admin scope, against a known classic-protected repo. Admin-gated.
  it.skipIf(!ADMIN_TOKEN)(
    "discovers a classic-protected repo's required checks with an admin token (check C)",
    async () => {
      const octokit = getOctokit(ADMIN_TOKEN as string);
      const checks = await discoverRequiredChecks(
        octokit,
        'mixmaxhq',
        'monorepo-experimental',
        'main',
      );
      expect(checks.length).toBeGreaterThan(0);
    },
  );
});
