import { SetupError } from './errors.ts';
import type { GhClient } from './gh.ts';
import {
  type AppCredentials,
  type ManifestFlowDeps,
  abortOnEnter,
  runManifestFlow,
} from './loopback.ts';
import { buildManifest } from './manifest.ts';

export type InstallTarget = { kind: 'personal' } | { kind: 'org'; org: string };

/**
 * Where the App must be registered, derived from the repo's owner (spec §4.2).
 *
 * Not a choice: the manifest registers a *private* App, and GitHub only offers the Install button
 * for a private App on the account that owns it ("if you set your GitHub App registration to
 * private, it can only be installed on the account that owns the app"). An App owned by anyone but
 * the repo's owner is therefore uninstallable on that repo — so we derive the owner and fail
 * loudly when we can't, rather than minting something that can't be used.
 */
export async function resolveTarget(owner: string, gh: GhClient): Promise<InstallTarget> {
  const viewer = await gh.viewerLogin();
  if (!viewer)
    throw new SetupError(
      'could not read your GitHub login',
      'Check `gh auth status` — setup needs to know which account you are before it can register an App.',
    );
  if (viewer.toLowerCase() === owner.toLowerCase()) return { kind: 'personal' };

  const type = await gh.accountType(owner);
  if (type === 'Organization') return { kind: 'org', org: owner };
  if (type === 'User')
    throw new SetupError(
      `this repository belongs to ${owner}, not to you or an organization`,
      `A private App can only be installed on the account that owns it, so ${owner} has to run setup on their own account. Fork the repository, or ask ${owner} to run it.`,
    );
  throw new SetupError(
    `could not tell whether ${owner} is a user or an organization`,
    'Check `gh auth status` and that the repository’s owner is visible to your token, then re-run.',
  );
}

export interface ProvisionAppFreshArgs {
  target: InstallTarget;
  owner: string;
  repo: string;
  gh: GhClient;
  openBrowser: (url: string) => Promise<void>;
  /** Injectable for tests; defaults to the real loopback handshake. */
  runFlow?: (deps: ManifestFlowDeps) => Promise<AppCredentials>;
  /** Injectable for tests; defaults to a "press Enter to cancel" abort. */
  onAbort?: (abort: () => void) => () => void;
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
    repoFullName: `${a.owner}/${a.repo}`,
    openBrowser: a.openBrowser,
    convert: (code) => a.gh.appConversion(code),
    onAbort: a.onAbort ?? abortOnEnter,
  });
}
