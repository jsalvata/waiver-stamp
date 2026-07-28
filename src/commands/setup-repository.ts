import { join } from 'node:path';
import { detectCommitlintBodyLimit } from '../setup/commitlint.ts';
import { seedConfigIfAbsent } from '../setup/config-seed.ts';
import { SetupError } from '../setup/errors.ts';
import { type GhClient, makeGh } from '../setup/gh.ts';
import { type Caveat, type HandoffArgs, handoffPage, setupDoc, specDoc } from '../setup/handoff.ts';
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
  };
}

/** Both branches are spelled out because the answer decides what gets created, not just where a
 *  file lands — and GitHub gives no way to re-download a key later, so it's a one-shot choice. */
const SAVE_KEY_QUESTION = [
  'This repository needs a GitHub App, and there are two ways to go about it:',
  '',
  '  yes — one App for your whole account. Its key is saved to ~/.waiver-stamp (mode 600),',
  '        and your other repositories reuse it with no browser step.',
  '  no  — an App just for this repository. Nothing is stored on disk, and setting up another',
  '        repository will create another App.',
  '',
  'GitHub never lets a key be downloaded twice, so declining means this App can only ever',
  'serve this repository. Save the key to allow reusing the App for your other repos?',
].join('\n');

export async function setupRepository(opts: SetupOptions, deps: SetupDeps): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const ctx = await deps.preflight(cwd);
  deps.info(`waiver-stamp setup: ${ctx.owner}/${ctx.repo} (default branch ${ctx.defaultBranch})`);

  // Phase 1 — the repo half (callers + seeded policy, §4.8/§4.11) and the required-check ruleset,
  // all independent of the App (§4.13). Done *before* provisioning so the fresh-path loopback
  // callback can render the finished hand-off in the tab GitHub redirects to, rather than a second
  // tab. The files are non-destructive and idempotent, so writing them before a provisioning that
  // may fail is safe — a failed run just re-runs, and they're skipped.
  const wfDir = join(cwd, '.github/workflows');
  const ciNames = await deps.discoverCiWorkflowNames(wfDir);
  const honesty = await deps.detectLockfileHonestyCheck(wfDir);
  const drop = await deps.writeCallerWorkflows(cwd, { ciWorkflowNames: ciNames });
  const seed = await deps.seedConfigIfAbsent(cwd, { lockfileHonestyCheck: honesty ?? undefined });

  // Advisories ride the hand-off page (persistent), not the scrolling terminal. Each links its own
  // doc section (version-pinned): the callers and commitlint live in the adopter checklist; the
  // lint-fix op only in the spec.
  const checklist = { href: setupDoc('#adopter-checklist'), label: 'adopter checklist' };
  const transformOps = {
    href: specDoc('#61-transform-ops-folded-over-base-compared-to-head'),
    label: 'spec §6.1',
  };
  const caveats: Caveat[] = [];
  for (const p of drop.skipped)
    caveats.push({
      text: `Existing ${p} left untouched — compare it against the caller the setup guide describes, and reconcile by hand.`,
      doc: checklist,
    });
  if ((await deps.detectCommitlintBodyLimit(cwd)).blocks)
    caveats.push({
      text: 'commitlint rejects long body lines; set `body-max-line-length: [0]` so waivered commits are not blocked.',
      doc: checklist,
    });
  const lint = await deps.detectLintFixLinter(cwd);
  if (lint.status === 'none')
    caveats.push({
      text: 'No supported linter (biome/eslint) declared — the lint-fix op is unavailable.',
      doc: transformOps,
    });
  else if (lint.status === 'ambiguous')
    caveats.push({
      text: `Multiple linters declared (${lint.declared.join(', ')}); lint-fix fails closed until you narrow to one.`,
      doc: transformOps,
    });

  // The required-check ruleset, gated on the producer caller being on the default branch (§4.13).
  // The `waiver-stamp` check only ever reports on PRs (the producer is `on: pull_request`), never on
  // default-branch commits — so its presence there, i.e. the callers have been merged, is the real
  // signal that requiring it won't block every PR on a check that never arrives. Creating it before
  // then is the one ordering mistake that breaks the adopter's repo.
  const producerPath = '.github/workflows/waiver-stamp-ci.yml';
  const producerOnDefault = await deps.gh.fileExistsOnRef(
    ctx.owner,
    ctx.repo,
    producerPath,
    ctx.defaultBranch,
  );
  if (producerOnDefault) {
    const r = await deps.ensureWaiverStampRuleset(deps.gh, ctx);
    deps.info(`waiver-stamp ruleset ${r}.`);
  } else {
    // The full instruction is the last step on the hand-off page; this is just the terminal
    // breadcrumb for when the browser can't take over.
    deps.info(
      'Not finished yet — complete the steps on the page opening now, then re-run `waiver setup-repository`.',
    );
  }

  // The hand-off page: only the steps we chose not to automate (§4.10). Its install step shows when
  // an App was provisioned (a slug); whether it's already installed is left to the reader (no
  // reliable user-token check exists — GET …/installation needs an App JWT). The slug isn't known
  // until provisioning, so render lazily.
  // The files this run put in place — the callers we wrote (or that already matched) plus the config
  // if we seeded it — named in the hand-off's copy-pasteable commit step.
  const writtenFiles = [...drop.written, ...(seed.seeded ? ['.waiver-stamp.json'] : [])];
  const renderHandoff = (slug: string): string =>
    deps.handoffPage({
      owner: ctx.owner,
      repo: ctx.repo,
      slug,
      defaultBranch: ctx.defaultBranch,
      configExisted: seed.existing,
      suggestedHonestyCheck: seed.existing ? honesty : null,
      producerOnDefault,
      writtenFiles,
      caveats,
    });

  // Phase 2 — provision the App + secrets. On the fresh path the manifest callback renders the
  // hand-off in its own tab (the tab GitHub redirected to), so nothing opens here. Every other path
  // (--no-app, converged resume, reuse, disk) has no such tab, so we open the hand-off as a file.
  const provisioned = await provisionApp(opts, deps, ctx, renderHandoff);
  if (!provisioned.handoffServed) await deps.openHandoff(renderHandoff(provisioned.slug ?? ''));
}

/**
 * Provision the App + secrets. Returns the App's slug (or `undefined` when nothing was provisioned:
 * `--no-app`, or a converged re-run whose secrets already exist) and `handoffServed` — true only on
 * the fresh path, where the loopback callback already rendered the hand-off in its tab, so the
 * caller must not open it again. Throws on a hard failure.
 */
async function provisionApp(
  opts: SetupOptions,
  deps: SetupDeps,
  ctx: RepoContext,
  renderHandoff: (slug: string) => string,
): Promise<{ slug: string | undefined; handoffServed: boolean }> {
  if (opts.noApp) {
    deps.info(
      '--no-app: skipping App provisioning — configure the auto-approval layer yourself, or leave it unconfigured.',
    );
    return { slug: undefined, handoffServed: false };
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
    return { slug: undefined, handoffServed: false };
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
    // Fresh only: the loopback callback serves this in its tab once the slug exists.
    renderDonePage: renderHandoff,
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

  // Fresh path: the loopback callback already rendered the hand-off in the tab GitHub redirected to,
  // so the caller opens no second page. Reuse/disk skip the manifest flow, so there's no such tab —
  // the caller opens the hand-off as a file; the terminal names the install link as a fallback.
  if (app.source === 'fresh') {
    deps.info(
      `App ${app.slug} ready; secrets written. The remaining steps are on the page in your browser.`,
    );
    return { slug: app.slug, handoffServed: true };
  }
  const installUrl = app.slug
    ? `https://github.com/apps/${app.slug}/installations/new`
    : `https://github.com/organizations/${target.kind === 'org' ? target.org : ctx.owner}/settings/installations`;
  deps.info(
    `Secrets ready. Complete the remaining steps — including installing the App (${installUrl}) — on the page opening in your browser.`,
  );
  return { slug: app.slug, handoffServed: false };
}
