import { SetupError } from '../setup/errors.ts';
import { type GhClient, makeGh } from '../setup/gh.ts';
import { openInstallGuidance } from '../setup/install-guidance.ts';
import { openBrowser } from '../setup/open-browser.ts';
import { type RepoContext, preflight } from '../setup/preflight.ts';
import { confirmYesNo } from '../setup/prompt.ts';
import { type InstallTarget, resolveTarget } from '../setup/provision-app.ts';
import { type ResolveAppDeps, type ResolvedApp, resolveApp } from '../setup/resolve-app.ts';
import { runCommand } from '../setup/run.ts';
import {
  type ProvisionSecretsArgs,
  SECRET_NAMES,
  grantExistingOrgSecrets,
  provisionSecrets,
} from '../setup/secrets.ts';

export interface SetupOptions {
  yes?: boolean;
  noApp?: boolean;
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
  /** Show the install guidance page, then the install link, for a reuse run (no loopback ran). */
  openInstallGuidance: (installUrl: string, repoFullName: string) => Promise<void>;
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
    openInstallGuidance: (url, repo) => openInstallGuidance(url, repo, openBrowser),
    info: (m) => console.log(m),
  };
}

/** Both branches are spelled out because the answer decides what gets created, not just where a
 *  file lands — and GitHub gives no way to re-download a key later, so it's a one-shot choice. */
const SAVE_KEY_QUESTION = [
  'This repository needs a GitHub App, and there are two ways to go about it:',
  '',
  '  yes — one App for your whole account. Its key is saved to ~/.waiver-install (mode 600),',
  '        and your other repositories reuse it with no browser step.',
  '  no  — an App just for this repository. Nothing is stored on disk, and setting up another',
  '        repository will create another App.',
  '',
  'GitHub never lets a key be downloaded twice, so declining means this App can only ever',
  'serve this repository. Save the key and reuse the App elsewhere?',
].join('\n');

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

  // Converge rather than duplicate (design §1): this repo already carries both secrets, so
  // provisioning again would mint a second App for no gain. Ahead of resolveTarget deliberately —
  // a repo owned by someone else can't resolve a target at all, yet is perfectly usable once its
  // owner has set it up.
  const repoSecrets = await deps.gh.repoSecretNames(`${ctx.owner}/${ctx.repo}`);
  if (SECRET_NAMES.every((n) => repoSecrets.includes(n))) {
    // Not silent: secrets written but the App never installed is the likeliest half-finished
    // state — someone closed the browser before the Install click — and a re-run is how they'd
    // expect to recover. We can't read a secret back to name the App, hence the listing page.
    deps.info(
      [
        `${ctx.owner}/${ctx.repo} already has both reviewer secrets — leaving them alone.`,
        'If the App is not installed on it yet, finish that at https://github.com/settings/installations',
        'To provision a different App instead, delete the two WAIVER_STAMP_* secrets and re-run.',
      ].join('\n'),
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
    confirmSaveKey: () => deps.confirmYesNo(SAVE_KEY_QUESTION),
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
  // A local guidance page opens first, because the install link jumps straight to GitHub where we
  // can't say anything; the terminal line repeats the URL for a headless opener that can't.
  const repoFull = `${ctx.owner}/${ctx.repo}`;
  deps.info(
    [
      `Secrets ready. A browser page is opening with the last step: install the App on ${repoFull}.`,
      `If it doesn't open, go to ${installUrl} and choose "Only select repositories", then pick ${repoFull}.`,
    ].join('\n'),
  );
  await deps.openInstallGuidance(installUrl, repoFull);

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
