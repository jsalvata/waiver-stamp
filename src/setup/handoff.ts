const DOC = 'https://github.com/jsalvata/waiver-stamp/blob/main/docs/auto-approval-setup.md';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  /** Page-only advisories (skipped callers, commitlint, lint) — rendered as a Caveats list. */
  caveats: string[];
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
    caveats,
  } = args;
  const repoFull = `${esc(owner)}/${esc(repo)}`;
  const steps: string[] = [];

  // Only when an App was actually provisioned: no slug ⇒ nothing to install (--no-app), and an
  // empty-slug install link would be broken.
  if (slug)
    steps.push(
      `<li>Install <b>${esc(slug)}</b> on <b>${repoFull}</b> if you haven't: open the <a href="https://github.com/apps/${esc(slug)}/installations/new">install page</a>, choose <b>Only select repositories</b>, pick <b>${repoFull}</b>, and click <b>Install</b>. Confirm it's listed under the App afterwards.</li>`,
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

  // Last, after every step that may edit repo content: commit those edits together with the callers,
  // land them on the default branch, and re-run to add the required-check ruleset (§4.13).
  if (!producerOnDefault)
    steps.push(
      `<li>Commit the two files under <code>.github/workflows/</code> (<code>waiver-stamp-ci.yml</code>, <code>waiver-stamp-review.yml</code>) together with any edits above, get them onto <b>${esc(defaultBranch)}</b> — open a PR and merge, or push — then re-run <code>waiver setup-repository</code> to add the required-check ruleset.</li>`,
    );

  const caveatsBlock =
    caveats.length > 0
      ? `\n<h2>Caveats</h2>\n<ul>\n${caveats.map((c) => `<li>${esc(c)}</li>`).join('\n')}\n</ul>`
      : '';

  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — finish setup</title>
<body>
<h1>${producerOnDefault ? 'Setup complete' : 'Almost done'} — ${repoFull}</h1>
<ol>
${steps.join('\n')}
</ol>${caveatsBlock}
<p><a href="${DOC}">docs/auto-approval-setup.md</a></p>`;
}
