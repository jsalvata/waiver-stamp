import { SetupError } from '../setup/errors.ts';
import { type GhClient, makeGh } from '../setup/gh.ts';
import type { AppCredentials } from '../setup/loopback.ts';
import { openBrowser } from '../setup/open-browser.ts';
import { type RepoContext, preflight } from '../setup/preflight.ts';
import {
  type InstallTarget,
  type ProvisionAppFreshArgs,
  provisionAppFresh,
  resolveTarget,
} from '../setup/provision-app.ts';
import { runCommand } from '../setup/run.ts';
import { type ProvisionSecretsArgs, provisionSecrets } from '../setup/secrets.ts';

export interface SetupOptions {
  yes?: boolean;
  noApp?: boolean;
  cwd?: string;
}

export interface SetupDeps {
  preflight: (cwd: string) => Promise<RepoContext>;
  gh: GhClient;
  resolveTarget: (owner: string, gh: GhClient) => Promise<InstallTarget>;
  provisionAppFresh: (a: ProvisionAppFreshArgs) => Promise<AppCredentials>;
  provisionSecrets: (gh: GhClient, a: ProvisionSecretsArgs) => Promise<void>;
  openBrowser: (url: string) => Promise<void>;
  info: (msg: string) => void;
}

/** Default wiring for the CLI (real shell + fs). PRs 5–6 extend App resolution (reuse/disk). */
export function makeSetupDeps(): SetupDeps {
  return {
    preflight: () => preflight({ run: runCommand }),
    gh: makeGh(runCommand),
    resolveTarget,
    provisionAppFresh,
    provisionSecrets,
    openBrowser,
    info: (m) => console.log(m),
  };
}

export async function setupRepository(opts: SetupOptions, deps: SetupDeps): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const ctx = await deps.preflight(cwd);
  deps.info(`waiver-stamp setup: ${ctx.owner}/${ctx.repo} (default branch ${ctx.defaultBranch})`);

  if (opts.noApp) {
    deps.info(
      '--no-app: skipping App provisioning — configure the auto-approval layer yourself, or leave it unconfigured.',
    );
    return;
  }

  const target = await deps.resolveTarget(ctx.owner, deps.gh);
  // Org secret writes need the `admin:org` token scope; without it the write 403s only AFTER the
  // App is created, leaving an orphan. Fail fast here when the token can't prove the scope.
  if (target.kind === 'org') {
    const scopes = await deps.gh.tokenScopes();
    if (scopes.length > 0 && !scopes.includes('admin:org'))
      throw new SetupError(
        'your GitHub token lacks the admin:org scope needed to write org secrets',
        'Run `gh auth refresh -h github.com -s admin:org` (as an org owner), then re-run setup.',
      );
  }

  deps.info(
    'Opening your browser — each page there tells you what to do: create the App, then install it\n' +
      'on this repository. Press Enter here to cancel.',
  );
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
  // No second browser tab: the done page (served on the loopback callback) forwards to the install
  // page in the same tab. Just point the user back to it.
  deps.info(`App ${app.slug} created; secrets written. Finish the Install step in your browser.`);
}
