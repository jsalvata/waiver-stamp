import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

// Docs are pinned to the running version's tag, so a link always points at the docs that match the
// callers this same run just wrote — which pin the reusable ref the same way (see workflows.ts).
const REPO = 'https://github.com/jsalvata/waiver-stamp';
const REF = `v${version}`;
/** A version-pinned link into the adopter guide, e.g. `setupDoc('#adopter-checklist')`. */
export const setupDoc = (anchor = ''): string =>
  `${REPO}/blob/${REF}/docs/auto-approval-setup.md${anchor}`;
/** A version-pinned link into the spec, e.g. `specDoc('#61-transform-ops-...')`. */
export const specDoc = (anchor = ''): string => `${REPO}/blob/${REF}/docs/spec.md${anchor}`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A page-only advisory, optionally carrying a version-pinned doc pointer rendered as a link. */
export interface Caveat {
  text: string;
  doc?: { href: string; label: string };
}

export interface HandoffArgs {
  owner: string;
  repo: string;
  /** The provisioned App's slug, or `''` when none was provisioned (`--no-app`, converged resume). */
  slug: string;
  defaultBranch: string;
  /** Whether `.waiver-stamp.json` was already there (vs seeded now) — changes only the wording. */
  configExisted: boolean;
  /** A detected lockfile-honesty check missing from an existing config — the one suggested edit. */
  suggestedHonestyCheck: string | null;
  /** Whether the producer caller is already on the default branch. When false, the page's last step
   *  is to get the callers there and re-run — it must follow every step that edits repo content. */
  producerOnDefault: boolean;
  /** The repo-relative files this run wrote (callers + seeded config) — named in the commit step's
   *  copy-pasteable `git add`. Empty when nothing was written (e.g. everything already in place). */
  writtenFiles: string[];
  /** Page-only advisories (skipped callers, commitlint, lint) — rendered as a Caveats list. */
  caveats: Caveat[];
}

/**
 * The final hand-off page (§4.10): only the steps we chose not to automate, as terse imperatives.
 * No rationale — the why lives in `docs/auto-approval-setup.md`, linked once at the bottom.
 */
export function handoffPage(args: HandoffArgs): string {
  const {
    owner,
    repo,
    slug,
    defaultBranch,
    configExisted,
    suggestedHonestyCheck,
    producerOnDefault,
    writtenFiles,
    caveats,
  } = args;
  const repoFull = `${esc(owner)}/${esc(repo)}`;
  const steps: string[] = [];

  // Only when an App was actually provisioned: no slug ⇒ nothing to install (--no-app), and an
  // empty-slug install link would be broken. No "if you haven't yet" hedge — this step renders
  // only when the App still needs installing on this repo (fresh: just created; reuse/disk: the App
  // lives elsewhere and this new repo needs it).
  if (slug)
    steps.push(
      `<li>Install <b>${esc(slug)}</b> on <b>${repoFull}</b>. Open the <a href="https://github.com/apps/${esc(slug)}/installations/new" target="_blank" rel="noopener">install page</a>, then:<ol><li>choose <b>Only select repositories</b> — not "All repositories";</li><li>pick <b>${repoFull}</b>;</li><li>click <b>Install</b>;</li><li>close that tab to come back here.</li></ol></li>`,
    );

  // The standing adopter choices (tune the policy, merge-method, optional protection) and the
  // commit/re-run step belong to finishing setup. Once the producer is on the default branch, setup
  // is complete: these are the same one-time choices the adopter already passed on the way here, so
  // repeating them under "Setup complete" only muddies it — docs/auto-approval-setup.md carries them.
  if (!producerOnDefault) {
    const configLede = configExisted
      ? 'Review your <b>.waiver-stamp.json</b>'
      : 'Review the seeded <b>.waiver-stamp.json</b>';
    const honesty = suggestedHonestyCheck
      ? ` Add <code>"lockfileHonestyCheck": "${esc(suggestedHonestyCheck)}"</code>.`
      : '';
    steps.push(
      `<li>${configLede}; set <code>allowBumping</code> / <code>changeDocs</code> to taste.${honesty}</li>`,
    );

    steps.push(
      `<li>Set <b>${repoFull}</b> to <b>merge-commit</b> or <b>rebase-merge</b> (not squash) — <a href="https://github.com/${repoFull}/settings#merge-button-settings" target="_blank" rel="noopener">Settings → General</a>.</li>`,
    );

    steps.push(
      `<li>(Optional) Protect <code>.github/**</code> on <b>${esc(defaultBranch)}</b> with CODEOWNERS or a ruleset.</li>`,
    );

    // Last, after every step that may edit repo content: land the files this run wrote (named in a
    // copy-pasteable `git add`) on the default branch, then re-run to add the ruleset (§4.13).
    const add =
      writtenFiles.length > 0
        ? ` — <code>git add ${writtenFiles.map(esc).join(' ')}</code>, commit,`
        : ' — commit the caller workflows and any edits above,';
    steps.push(
      `<li>Get the setup files onto <b>${esc(defaultBranch)}</b>${add} then open a PR and merge (or push). Re-run <code>waiver setup-repository</code> afterwards to add the required-check ruleset.</li>`,
    );
  }

  const renderCaveat = (c: Caveat): string => {
    const link = c.doc
      ? ` (<a href="${c.doc.href}" target="_blank" rel="noopener">${esc(c.doc.label)}</a>)`
      : '';
    return `<li>${esc(c.text)}${link}</li>`;
  };
  const caveatsBlock =
    caveats.length > 0
      ? `\n<h2>Caveats</h2>\n<ul>\n${caveats.map(renderCaveat).join('\n')}\n</ul>`
      : '';

  // Complete: confirm and stop. Finishing: an ordered list of what's left (install, and — when the
  // callers aren't merged yet — the adopter choices + commit/re-run). The list is omitted entirely
  // when empty (a converged "Setup complete" with the App already provisioned).
  const lede = producerOnDefault
    ? '\n<p>The <code>waiver-stamp</code> ruleset is in place; waivered PRs will auto-approve.</p>'
    : '';
  const stepsBlock = steps.length > 0 ? `\n<ol>\n${steps.join('\n')}\n</ol>` : '';

  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — finish setup</title>
<body>
<h1>${producerOnDefault ? 'Setup complete' : 'Finish setup'} — ${repoFull}</h1>${lede}${stepsBlock}${caveatsBlock}
<p><a href="${setupDoc()}" target="_blank" rel="noopener">docs/auto-approval-setup.md</a></p>`;
}
