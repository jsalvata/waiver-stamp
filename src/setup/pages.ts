import type { AppManifest } from './manifest.ts';

/**
 * The manifest POST to GitHub's App-creation endpoint (the manifest rides in a `manifest` field,
 * so the flow requires a form POST). Deliberately NOT auto-submitting: this is the only page we
 * control before GitHub's create form, so it's the last place to say anything — auto-submitting
 * would flash past it.
 */
export function formPage(action: string, manifest: AppManifest): string {
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
  return `<!doctype html><meta charset=utf-8><title>Create waiver-stamp App</title>
<body>
<h1>Create the waiver-stamp GitHub App</h1>
<p>The button below opens GitHub's App-creation page. There, click the green
<b>Create GitHub App</b>.</p>
<p>Keeping the suggested name is easiest: on an organisation it's how waiver-stamp finds this App's
install page, and either way it's how you'll recognise it among your other Apps. Renaming won't
stop your other repositories reusing it.</p>
<form action="${action}" method="post">
<input type="hidden" name="manifest" value='${json}'>
<button type="submit">Continue to GitHub →</button>
</form>`;
}

/**
 * Shown after conversion succeeds (spec §3.3). GitHub's install page defaults to "All
 * repositories" and gives no hint which repo to pick, so spell that out here — the last page we
 * control. No auto-redirect: the user needs to read this before landing there.
 */
export function donePage(installUrl: string, repoFullName: string): string {
  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — install</title>
<body>
<h1>App created ✓</h1>
<p>Last step: install it on <b>${repoFullName}</b>. On the page that opens:</p>
<ol>
<li>Choose <b>Only select repositories</b> (not "All repositories").</li>
<li>Pick <b>${repoFullName}</b> from the list.</li>
<li>Click <b>Install</b>.</li>
<li>That's it — close this tab and return to your terminal.</li>
</ol>
<p><a href="${installUrl}">Open the install page →</a></p>`;
}
