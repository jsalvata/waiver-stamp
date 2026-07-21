import { SetupError } from '../setup/errors.ts';
import { type GhClient, makeGh } from '../setup/gh.ts';
import { openBrowser } from '../setup/open-browser.ts';
import { type RepoContext, preflight } from '../setup/preflight.ts';
import { confirmYesNo } from '../setup/prompt.ts';
import { type InstallTarget, resolveTarget } from '../setup/provision-app.ts';
import { type ResolveAppDeps, type ResolvedApp, resolveApp } from '../setup/resolve-app.ts';
import { runCommand } from '../setup/run.ts';
import {
  type ProvisionSecretsArgs,
  grantExistingOrgSecrets,
  provisionSecrets,
} from '../setup/secrets.ts';

export interface SetupOptions {
  yes?: boolean;
  noApp?: boolean;
  saveKey?: boolean;
  cwd?: string;
}

export interface SetupDeps {
  preflight: (cwd: string) => Promise<RepoContext>;
  gh: GhClient;
  resolveTarget: (owner: string, gh: GhClient) => Promise<InstallTarget>;
  resolveApp: (d: ResolveAppDeps) => Promise<ResolvedApp>;
  provisionSecrets: (gh: GhClient, a: ProvisionSecretsArgs) => Promise<void>;
  grantExistingOrgSecrets: (
    gh: GhClient,
    a: { org: string; owner: string; repo: string; info: (msg: string) => void },
  ) => Promise<void>;
  confirmYesNo: (question: string) => Promise<boolean>;
  openBrowser: (url: string) => Promise<void>;
  info: (msg: string) => void;
}

/** Default wiring for the CLI (real shell + fs). PR 6 adds the repo-config phase. */
export function makeSetupDeps(): SetupDeps {
  return {
    preflight: () => preflight({ run: runCommand }),
    gh: makeGh(runCommand),
    resolveTarget,
    resolveApp,
    provisionSecrets,
    grantExistingOrgSecrets,
    confirmYesNo: (q) => confirmYesNo(q),
    openBrowser,
    info: (m) => console.log(m),
  };
}

const SAVE_KEY_QUESTION =
  'Save the App ID and private key under ~/.waiver-install so you can set up your other\n' +
  'repositories without repeating the browser step? (a private key at rest on disk, mode 600)';

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

  const app = await deps.resolveApp({
    target,
    owner: ctx.owner,
    repo: ctx.repo,
    gh: deps.gh,
    openBrowser: deps.openBrowser,
    confirmSaveKey: () =>
      opts.saveKey ? Promise.resolve(true) : deps.confirmYesNo(SAVE_KEY_QUESTION),
    info: deps.info,
  });

  if (app.pem && app.appId !== undefined) {
    await writeSecrets(app.appId, app.pem);
  } else if (target.kind === 'org') {
    await deps.grantExistingOrgSecrets(deps.gh, {
      org: target.org,
      owner: ctx.owner,
      repo: ctx.repo,
      info: deps.info,
    });
  }

  if (app.source === 'fresh') {
    // The done page served on the loopback callback already forwards to install in that same tab.
    deps.info(`App ${app.slug} ready; secrets written. Finish the Install step in your browser.`);
    return;
  }
  // Reuse skipped the manifest flow, so no tab is open — but the App still has to be installed on
  // this repo, and only GitHub's picker can do that.
  const installUrl = app.slug
    ? `https://github.com/apps/${app.slug}/installations/new`
    : `https://github.com/organizations/${target.kind === 'org' ? target.org : ctx.owner}/settings/installations`;
  deps.info(
    `Secrets ready. Last step: install the App on ${ctx.owner}/${ctx.repo} — choose "Only select\n` +
      `repositories" and pick it. Opening ${installUrl}`,
  );
  await deps.openBrowser(installUrl);

  async function writeSecrets(appId: number, pem: string): Promise<void> {
    try {
      await deps.provisionSecrets(deps.gh, {
        target,
        appId,
        pem,
        owner: ctx.owner,
        repo: ctx.repo,
      });
    } catch (e) {
      // The App exists on GitHub from the moment conversion succeeded; without its URL the user
      // has no way to find and delete the orphan we just left behind.
      const settings =
        target.kind === 'org'
          ? `https://github.com/organizations/${target.org}/settings/apps/${app.slug}`
          : `https://github.com/settings/apps/${app.slug}`;
      throw new SetupError(
        'the App was created but its secrets could not be written',
        `Delete the App at ${settings} and re-run setup, or set WAIVER_STAMP_APP_ID / WAIVER_STAMP_APP_PRIVATE_KEY by hand.`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}
