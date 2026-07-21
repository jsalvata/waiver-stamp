import type { GhClient, SetSecretArgs } from './gh.ts';
import type { InstallTarget } from './provision-app.ts';

/** The two conventional reviewer secrets (§4.5). Their presence at org scope is also the reuse
 *  signal (§4.3), so both readers and writers key off this one list. */
export const SECRET_NAMES = ['WAIVER_STAMP_APP_ID', 'WAIVER_STAMP_APP_PRIVATE_KEY'] as const;

export interface ProvisionSecretsArgs {
  target: InstallTarget;
  appId: number;
  pem: string;
  owner: string;
  repo: string;
}

/** Write the two conventional reviewer secrets at the chosen scope. Idempotent; touches no others. */
export async function provisionSecrets(gh: GhClient, a: ProvisionSecretsArgs): Promise<void> {
  const common: Pick<SetSecretArgs, 'scope' | 'org' | 'repo'> =
    a.target.kind === 'org'
      ? { scope: 'org', org: a.target.org, repo: `${a.owner}/${a.repo}` }
      : { scope: 'repo', repo: `${a.owner}/${a.repo}` };
  await gh.setSecret({ name: SECRET_NAMES[0], value: String(a.appId), ...common });
  await gh.setSecret({ name: SECRET_NAMES[1], value: a.pem, ...common });
}

/**
 * Reuse path (§4.3): the org secrets already hold a key we can't read, so widen their
 * selected-repositories list to cover this repo instead of rewriting them — rewriting would need a
 * pem, and re-minting one would invalidate every repo already running against the old App.
 */
export async function grantExistingOrgSecrets(
  gh: GhClient,
  a: { org: string; owner: string; repo: string },
): Promise<void> {
  for (const name of SECRET_NAMES) await gh.grantOrgSecretRepo(a.org, name, `${a.owner}/${a.repo}`);
}
