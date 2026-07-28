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
<p><b>If GitHub says the name is already taken</b>, a waiver-stamp App by this name already exists —
a leftover from an earlier attempt, or, on an organisation, one shared across repositories. To reuse
it (don't delete a shared App): cancel here — press Enter in the terminal — set this repo's
<code>WAIVER_STAMP_APP_ID</code> and <code>WAIVER_STAMP_APP_PRIVATE_KEY</code> secrets from the App's
own settings (generate a fresh private key there if you no longer have one), then re-run — setup
skips creating one when those secrets are present. Delete the App only if nothing uses it.</p>
<form action="${action}" method="post">
<input type="hidden" name="manifest" value='${json}'>
<button type="submit">Continue to GitHub →</button>
</form>`;
}
