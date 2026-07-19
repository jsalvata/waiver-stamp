import { getOctokit } from '@actions/github';
import { describe, expect, it } from 'vitest';
import { makeResolvePr } from './adapters.ts';
import { discoverRequiredChecks } from './discover-checks.ts';

// Live-API suite (excluded from `pnpm test`; run via `pnpm test:integration`). Autodiscovery's
// classic-endpoint read needs `administration: read`; a non-admin token gets 403 there, so the
// discovery-success checks are gated on a KNOWN-admin token and the resolve/403 checks on a
// KNOWN-non-admin token. See docs/superpowers/specs/2026-07-19-autodiscovery-e2e-design.md.
const ADMIN = process.env.WAIVER_E2E_ADMIN_TOKEN; // a token WITH administration:read
const NONADMIN = process.env.WAIVER_E2E_NONADMIN_TOKEN; // a token WITHOUT it (CI: github.token)
const HEAD_SHA = process.env.WAIVER_E2E_HEAD_SHA; // a real open PR's head SHA
const SHA_RE = /^[0-9a-f]{40}$/;

describe('autodiscovery — live GitHub API', () => {
  // Check A1 — resolve seam (no admin needed; makeResolvePr uses pull-requests:read). The PR-1
  // bug fed pr.base.sha (a SHA) to the branch-name endpoint; guard the field shapes live.
  it.skipIf(!NONADMIN || !HEAD_SHA)(
    'resolves the PR base as a ref, not a SHA (check A1)',
    async () => {
      const octokit = getOctokit(NONADMIN as string);
      const pr = await makeResolvePr(octokit)('jsalvata', 'waiver-stamp', HEAD_SHA as string);
      if (!pr) throw new Error('expected an open PR for the head SHA');
      expect(pr.baseRef).not.toMatch(SHA_RE); // a branch name, e.g. "main"
      expect(pr.base).toMatch(SHA_RE); // a 40-hex SHA
    },
  );

  // Check A2 — full resolve→discover with an admin token (discovery needs the classic read).
  it.skipIf(!ADMIN || !HEAD_SHA)(
    "discovers the resolved base branch's required checks (check A2)",
    async () => {
      const octokit = getOctokit(ADMIN as string);
      const pr = await makeResolvePr(octokit)('jsalvata', 'waiver-stamp', HEAD_SHA as string);
      if (!pr) throw new Error('expected an open PR for the head SHA');
      const checks = await discoverRequiredChecks(octokit, 'jsalvata', 'waiver-stamp', pr.baseRef);
      if (pr.baseRef === 'main') expect(checks).toContain('lockfile-assay');
    },
  );

  // Check B — rules endpoint via the union, admin token (classic 404s here → union = rules).
  it.skipIf(!ADMIN)("discovers this repo's ruleset required checks (check B)", async () => {
    const octokit = getOctokit(ADMIN as string);
    const checks = await discoverRequiredChecks(octokit, 'jsalvata', 'waiver-stamp', 'main');
    expect(checks).toContain('lockfile-assay');
  });

  // Check C — classic endpoint, admin token, against a known classic-protected repo.
  it.skipIf(!ADMIN)("discovers a classic-protected repo's required checks (check C)", async () => {
    const octokit = getOctokit(ADMIN as string);
    const checks = await discoverRequiredChecks(
      octokit,
      'mixmaxhq',
      'monorepo-experimental',
      'main',
    );
    expect(checks.length).toBeGreaterThan(0);
  });

  // Check D — the 403 the override fallback exists for: a non-admin token can't read the classic
  // endpoint (a permission check before existence), so the union rejects.
  it.skipIf(!NONADMIN)('rejects discovery with a non-admin token (check D)', async () => {
    const octokit = getOctokit(NONADMIN as string);
    await expect(
      discoverRequiredChecks(octokit, 'jsalvata', 'waiver-stamp', 'main'),
    ).rejects.toThrow();
  });
});
