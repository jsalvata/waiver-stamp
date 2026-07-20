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

/** Shown after conversion succeeds; links the interactive install page (spec §3.3). */
export function donePage(installUrl: string): string {
  return `<!doctype html><meta charset=utf-8><title>waiver-stamp — install</title>
<body><h1>App created ✓</h1><p>Last step: <a href="${installUrl}">install it on your repository</a>, then return to your terminal.</p>`;
}
