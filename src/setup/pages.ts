import type { AppManifest } from './manifest.ts';

/**
 * A self-submitting form that POSTs the manifest to GitHub's App-creation endpoint (the manifest
 * rides in a `manifest` field, so the flow requires a form POST). The loopback server serves it
 * and the browser submits it.
 */
export function formPage(action: string, manifest: AppManifest): string {
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
  return `<!doctype html><meta charset=utf-8><title>Create waiver-stamp App</title>
<body onload="document.forms[0].submit()">
<form action="${action}" method="post">
<input type="hidden" name="manifest" value='${json}'>
<noscript><button type="submit">Create the waiver-stamp GitHub App</button></noscript>
</form>`;
}

/**
 * Shown after conversion succeeds (spec §3.3). Auto-forwards to the interactive install page in
 * the same tab (the meta refresh) so the CLI never has to open a second browser tab, with a manual
 * link as the fallback if the redirect is blocked.
 */
export function donePage(installUrl: string): string {
  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — install</title>
<meta http-equiv="refresh" content="2;url=${installUrl}">
<body><h1>App created ✓</h1>
<p>Last step: pick this repository and click <b>Install</b>.</p>
<p>Taking you to the install page… if nothing happens, <a href="${installUrl}">open it here</a>, then return to your terminal.</p>`;
}
