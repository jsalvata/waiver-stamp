import { join } from 'node:path';
import { detectCommitlintBodyLimit } from '../setup/commitlint.ts';
import { seedConfigIfAbsent } from '../setup/config-seed.ts';
import { SetupError } from '../setup/errors.ts';
import { type GhClient, makeGh } from '../setup/gh.ts';
import { type HandoffArgs, handoffPage } from '../setup/handoff.ts';
import { openInstallGuidance } from '../setup/install-guidance.ts';
import { type LintFixAdvisory, detectLintFixLinter } from '../setup/lint.ts';
import { openBrowser } from '../setup/open-browser.ts';
import { openLocalPage } from '../setup/open-local-page.ts';
import { type RepoContext, preflight } from '../setup/preflight.ts';
import { confirmYesNo } from '../setup/prompt.ts';
import { type InstallTarget, resolveTarget } from '../setup/provision-app.ts';
import { type ResolveAppDeps, type ResolvedApp, resolveApp } from '../setup/resolve-app.ts';
import { ensureWaiverStampRuleset } from '../setup/ruleset.ts';
import { runCommand } from '../setup/run.ts';
import {
  type ProvisionSecretsArgs,
  SECRET_NAMES,
  grantExistingOrgSecrets,
  provisionSecrets,
} from '../setup/secrets.ts';
import {
  detectLockfileHonestyCheck,
  discoverCiWorkflowNames,
  writeCallerWorkflows,
} from '../setup/workflows.ts';

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
  discoverCiWorkflowNames: (dir: string) => Promise<string[]>;
  detectLockfileHonestyCheck: (dir: string) => Promise<string | null>;
  writeCallerWorkflows: (
    cwd: string,
    a: { ciWorkflowNames: string[] },
  ) => Promise<{ written: string[]; skipped: string[] }>;
  seedConfigIfAbsent: (
    cwd: string,
    a: { lockfileHonestyCheck?: string },
  ) => Promise<{ seeded: boolean; existing: boolean }>;
  detectCommitlintBodyLimit: (cwd: string) => Promise<{ blocks: boolean }>;
  detectLintFixLinter: (cwd: string) => Promise<LintFixAdvisory>;
  ensureWaiverStampRuleset: (
    gh: GhClient,
    a: { owner: string; repo: string; defaultBranch: string },
  ) => Promise<'created' | 'exists'>;
  handoffPage: (args: HandoffArgs) => string;
  /** Write the hand-off HTML to a local file and open it (openBrowser only takes a URL). */
  openHandoff: (html: string) => Promise<void>;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Default wiring for the CLI (real shell + fs). */
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
    discoverCiWorkflowNames,
    detectLockfileHonestyCheck,
    writeCallerWorkflows,
    seedConfigIfAbsent,
    detectCommitlintBodyLimit: (cwd) => detectCommitlintBodyLimit(cwd, runCommand),
    detectLintFixLinter,
    ensureWaiverStampRuleset,
    handoffPage,
    openHandoff: (html) => openLocalPage(html, openBrowser),
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
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

  // Phase 1a — provision the App and its secrets. The file/config half (Phase 1b onward) is
  // independent, so this whole block is skipped on --no-app or on a converged re-run, but the rest
  // still runs. A hard failure here (missing scope, orphaned App) aborts before touching files.
  const slug = await provisionApp(opts, deps, ctx);

  // Phase 1b — the caller workflows and the seeded policy (§4.8, §4.11). Always: the App and the
  // config are separate channels (§4.13).
  const wfDir = join(cwd, '.github/workflows');
  const ciNames = await deps.discoverCiWorkflowNames(wfDir);
  const honesty = await deps.detectLockfileHonestyCheck(wfDir);
  const drop = await deps.writeCallerWorkflows(cwd, { ciWorkflowNames: ciNames });
  for (const p of drop.skipped) deps.warn(`left existing ${p} untouched — reconcile by hand.`);
  const seed = await deps.seedConfigIfAbsent(cwd, { lockfileHonestyCheck: honesty ?? undefined });

  if ((await deps.detectCommitlintBodyLimit(cwd)).blocks)
    deps.warn('commitlint rejects long body lines; set `body-max-line-length: [0]` (spec §4.7).');
  const lint = await deps.detectLintFixLinter(cwd);
  if (lint.status === 'none')
    deps.warn(
      'no supported linter (biome/eslint) declared — the lint-fix op is unavailable (spec §6.1).',
    );
  else if (lint.status === 'ambiguous')
    deps.warn(
      `multiple linters declared (${lint.declared.join(', ')}); lint-fix fails closed until you narrow to one (spec §6.1).`,
    );

  // Phase 2 — the required-check ruleset, gated on the producer having run at least once (§4.13):
  // requiring a check that never reported would block every PR. Creating it early is the one
  // ordering mistake that breaks the adopter's repo, so it is explicitly gated.
  if (await deps.gh.checkRunPresent(ctx.owner, ctx.repo, ctx.defaultBranch, 'waiver-stamp')) {
    const r = await deps.ensureWaiverStampRuleset(deps.gh, ctx);
    deps.info(`waiver-stamp ruleset ${r}.`);
  } else {
    deps.info(
      'Merge the workflows PR (or push the callers) so the waiver-stamp check runs once, then re-run `waiver setup-repository` to add the required-check ruleset.',
    );
  }

  // Phase 3 — the hand-off page: only the steps we chose not to automate (§4.10). The install step
  // shows when a slug was provisioned; whether it's already installed is left to the reader (no
  // reliable user-token check exists — GET …/installation needs an App JWT).
  await deps.openHandoff(
    deps.handoffPage({
      owner: ctx.owner,
      repo: ctx.repo,
      slug: slug ?? '',
      defaultBranch: ctx.defaultBranch,
      configExisted: seed.existing,
      suggestedHonestyCheck: seed.existing ? honesty : null,
    }),
  );
}

/**
 * Provision the App + secrets, returning its slug (or `undefined` when nothing was provisioned:
 * `--no-app`, or a converged re-run whose secrets already exist). Throws on a hard failure.
 */
async function provisionApp(
  opts: SetupOptions,
  deps: SetupDeps,
  ctx: RepoContext,
): Promise<string | undefined> {
  if (opts.noApp) {
    deps.info(
      '--no-app: skipping App provisioning — configure the auto-approval layer yourself, or leave it unconfigured.',
    );
    return undefined;
  }

  // Converge rather than duplicate (design §1): this repo already carries both secrets, so
  // provisioning again would mint a second App for no gain. The resume still falls through to the
  // config/ruleset/hand-off phases — on the personal path those secrets were written a run ago.
  const repoSecrets = await deps.gh.repoSecretNames(`${ctx.owner}/${ctx.repo}`);
  if (SECRET_NAMES.every((n) => repoSecrets.includes(n))) {
    deps.info(
      [
        `${ctx.owner}/${ctx.repo} already has both reviewer secrets — leaving them alone.`,
        'If the App is not installed on it yet, finish that at https://github.com/settings/installations',
        'To provision a different App instead, delete the two WAIVER_STAMP_* secrets and re-run.',
      ].join('\n'),
    );
    return undefined;
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
    try {
      await deps.provisionSecrets(deps.gh, {
        target,
        appId: app.appId,
        pem: app.pem,
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
    return app.slug;
  }
  // Reuse/disk skipped the manifest flow, so no tab is open — but the App still has to be installed
  // on this repo, and only GitHub's picker can do that.
  const installUrl = app.slug
    ? `https://github.com/apps/${app.slug}/installations/new`
    : `https://github.com/organizations/${target.kind === 'org' ? target.org : ctx.owner}/settings/installations`;
  const repoFull = `${ctx.owner}/${ctx.repo}`;
  deps.info(
    [
      `Secrets ready. A browser page is opening with the last step: install the App on ${repoFull}.`,
      `If it doesn't open, go to ${installUrl} and choose "Only select repositories", then pick ${repoFull}.`,
    ].join('\n'),
  );
  await deps.openInstallGuidance(installUrl, repoFull);
  return app.slug;
}
