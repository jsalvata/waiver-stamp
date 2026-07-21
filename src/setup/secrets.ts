import type { GhClient, SetSecretArgs } from './gh.ts';
import type { InstallTarget } from './provision-app.ts';

/** The two conventional reviewer secrets (§4.5). */
export const APP_ID_SECRET = 'WAIVER_STAMP_APP_ID';
export const APP_KEY_SECRET = 'WAIVER_STAMP_APP_PRIVATE_KEY';
/** Both, for the readers/writers that iterate — their presence at org scope is the reuse signal
 *  (§4.3), so those callers key off this one list. */
export const SECRET_NAMES = [APP_ID_SECRET, APP_KEY_SECRET] as const;

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
  await gh.setSecret({ name: APP_ID_SECRET, value: String(a.appId), ...common });
  await gh.setSecret({ name: APP_KEY_SECRET, value: a.pem, ...common });
}

/**
 * Reuse path (§4.3): the org secrets already hold a key we can't read, so widen their
 * selected-repositories list to cover this repo instead of rewriting them — rewriting would need a
 * pem, and re-minting one would invalidate every repo already running against the old App.
 *
 * Only `selected` secrets need (or accept) the grant: at `all` or `private` visibility the repo
 * can already read them, and the grant endpoint would 409 on a configuration that works fine.
 */
export async function grantExistingOrgSecrets(
  gh: GhClient,
  a: { org: string; owner: string; repo: string; info: (msg: string) => void },
): Promise<void> {
  const existing = await gh.orgSecrets(a.org);
  for (const name of SECRET_NAMES) {
    const visibility = existing.find((s) => s.name === name)?.visibility ?? 'selected';
    if (visibility === 'selected') {
      await gh.grantOrgSecretRepo(a.org, name, `${a.owner}/${a.repo}`);
      continue;
    }
    const note =
      visibility === 'all'
        ? `every repository in ${a.org} can read it — narrow it to selected repositories if that is wider than you want`
        : `only ${a.org}'s private repositories can read it, so a public repository will not see it`;
    a.info(`Note: ${name} already reaches this repository; ${note}.`);
  }
}
