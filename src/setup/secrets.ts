import type { GhClient, SetSecretArgs } from './gh.ts';
import type { InstallTarget } from './provision-app.ts';

export interface ProvisionSecretsArgs {
  target: InstallTarget;
  appId: number;
  pem: string;
  owner: string;
  repo: string;
}

/** Write the two conventional reviewer secrets at the chosen scope. Idempotent; touches no others. */
export async function provisionSecrets(gh: GhClient, a: ProvisionSecretsArgs): Promise<void> {
  const common: Pick<SetSecretArgs, 'scope' | 'org' | 'repos' | 'repo'> =
    a.target.kind === 'org'
      ? { scope: 'org', org: a.target.org, repos: [`${a.owner}/${a.repo}`] }
      : { scope: 'repo', repo: `${a.owner}/${a.repo}` };
  await gh.setSecret({ name: 'WAIVER_STAMP_APP_ID', value: String(a.appId), ...common });
  await gh.setSecret({ name: 'WAIVER_STAMP_APP_PRIVATE_KEY', value: a.pem, ...common });
}
