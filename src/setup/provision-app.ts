import type { GhClient } from './gh.ts';
import { type AppCredentials, type ManifestFlowDeps, runManifestFlow } from './loopback.ts';
import { buildManifest } from './manifest.ts';

export type InstallTarget = { kind: 'personal' } | { kind: 'org'; org: string };

/**
 * Resolve the install target from `--target` (spec §4.2, D9). `personal` or absent installs the
 * App on the user account; a non-empty login installs it on that org. Interactive org-picking
 * (offering `gh.listOrgs()`) is PR 5; this PR takes the preferred value or defaults to personal.
 */
export async function chooseTarget(
  preferred: string | undefined,
  _gh: GhClient,
): Promise<InstallTarget> {
  if (preferred && preferred !== 'personal') return { kind: 'org', org: preferred };
  return { kind: 'personal' };
}

export interface ProvisionAppFreshArgs {
  target: InstallTarget;
  owner: string;
  repo: string;
  gh: GhClient;
  openBrowser: (url: string) => Promise<void>;
  /** Injectable for tests; defaults to the real loopback handshake. */
  runFlow?: (deps: ManifestFlowDeps) => Promise<AppCredentials>;
}

/**
 * Create a brand-new App via the manifest handshake and return its credentials. Reuse-existing-App
 * and pem-on-disk short-circuits are PR 5; this PR always runs the fresh flow.
 */
export async function provisionAppFresh(a: ProvisionAppFreshArgs): Promise<AppCredentials> {
  const manifest = buildManifest({
    owner: a.owner,
    appUrl: `https://github.com/${a.owner}/${a.repo}`,
  });
  const runFlow = a.runFlow ?? runManifestFlow;
  return runFlow({
    target: a.target,
    manifest,
    openBrowser: a.openBrowser,
    convert: (code) => a.gh.appConversion(code),
  });
}
