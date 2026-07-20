import { access } from 'node:fs/promises';
import { type GhClient, makeGh } from '../setup/gh.ts';
import type { AppCredentials } from '../setup/loopback.ts';
import { openBrowser } from '../setup/open-browser.ts';
import { type RepoContext, preflight } from '../setup/preflight.ts';
import {
  type InstallTarget,
  type ProvisionAppFreshArgs,
  chooseTarget,
  provisionAppFresh,
} from '../setup/provision-app.ts';
import { runCommand } from '../setup/run.ts';
import { type ProvisionSecretsArgs, provisionSecrets } from '../setup/secrets.ts';

export interface SetupOptions {
  yes?: boolean;
  target?: string;
  noApp?: boolean;
  cwd?: string;
}

export interface SetupDeps {
  preflight: (cwd: string) => Promise<RepoContext>;
  gh: GhClient;
  chooseTarget: (preferred: string | undefined, gh: GhClient) => Promise<InstallTarget>;
  provisionAppFresh: (a: ProvisionAppFreshArgs) => Promise<AppCredentials>;
  provisionSecrets: (gh: GhClient, a: ProvisionSecretsArgs) => Promise<void>;
  openBrowser: (url: string) => Promise<void>;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Default wiring for the CLI (real shell + fs). PRs 5–6 extend App resolution (reuse/disk). */
export function makeSetupDeps(): SetupDeps {
  return {
    preflight: (cwd) =>
      preflight(cwd, {
        run: runCommand,
        exists: async (p) =>
          access(p)
            .then(() => true)
            .catch(() => false),
      }),
    gh: makeGh(runCommand),
    chooseTarget,
    provisionAppFresh,
    provisionSecrets,
    openBrowser,
    info: (m) => console.log(m),
    warn: (m) => console.warn(`warning: ${m}`),
  };
}

export async function setupRepository(opts: SetupOptions, deps: SetupDeps): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const ctx = await deps.preflight(cwd);
  deps.info(`waiver-stamp setup: ${ctx.owner}/${ctx.repo} (default branch ${ctx.defaultBranch})`);
  if (!ctx.pnpm)
    deps.warn(
      'no `pnpm-lock.yaml` found — dependency bumps can’t be waived; a waivered commit that changes `package.json` will be rejected.',
    );

  if (opts.noApp) {
    deps.info(
      '--no-app: skipping App provisioning — configure the auto-approval layer yourself, or leave it unconfigured.',
    );
    return;
  }

  const target = await deps.chooseTarget(opts.target, deps.gh);
  const app = await deps.provisionAppFresh({
    target,
    owner: ctx.owner,
    repo: ctx.repo,
    gh: deps.gh,
    openBrowser: deps.openBrowser,
  });
  await deps.provisionSecrets(deps.gh, {
    target,
    appId: app.appId,
    pem: app.pem,
    owner: ctx.owner,
    repo: ctx.repo,
  });
  deps.info(`App ${app.slug} created; secrets written.`);
  await deps.openBrowser(`https://github.com/apps/${app.slug}/installations/new`);
}
