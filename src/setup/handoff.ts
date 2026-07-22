const DOC = 'https://github.com/jsalvata/waiver-stamp/blob/main/docs/auto-approval-setup.md';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface HandoffArgs {
  owner: string;
  repo: string;
  slug: string;
  defaultBranch: string;
  /** Whether the App is already installed on the repo — hides the confirm-install step when true. */
  installDetected: boolean;
  /** Whether `.waiver-stamp.json` was already there (vs seeded now) — changes only the wording. */
  configExisted: boolean;
  /** A detected lockfile-honesty check missing from an existing config — the one suggested edit. */
  suggestedHonestyCheck: string | null;
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
    installDetected,
    configExisted,
    suggestedHonestyCheck,
  } = args;
  const repoFull = `${esc(owner)}/${esc(repo)}`;
  const steps: string[] = [];

  if (!installDetected)
    steps.push(
      `<li>Confirm <b>${esc(slug)}</b> is installed on <b>${repoFull}</b> — ` +
        `<a href="https://github.com/apps/${esc(slug)}/installations/new">install it</a>.</li>`,
    );

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
    `<li>Set <b>${repoFull}</b> to <b>merge-commit</b> or <b>rebase-merge</b> (not squash) — ` +
      `<a href="https://github.com/${repoFull}/settings">Settings → General</a>.</li>`,
  );

  steps.push(
    `<li>(Optional) Protect <code>.github/**</code> on <b>${esc(defaultBranch)}</b> with CODEOWNERS or a ruleset.</li>`,
  );

  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — finish setup</title>
<body>
<h1>Almost done — ${repoFull}</h1>
<ol>
${steps.join('\n')}
</ol>
<p><a href="${DOC}">docs/auto-approval-setup.md</a></p>`;
}
