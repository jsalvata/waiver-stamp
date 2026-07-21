import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SetupError } from './errors.ts';
import type { AppManifest } from './manifest.ts';
import { donePage, formPage } from './pages.ts';

export interface AppCredentials {
  appId: number;
  pem: string;
  slug: string;
}

export interface ManifestFlowDeps {
  target: { kind: 'personal' } | { kind: 'org'; org: string };
  manifest: AppManifest;
  /** `owner/repo`, named on the done page so the user knows which repo to pick when installing. */
  repoFullName?: string;
  openBrowser: (url: string) => Promise<void>;
  convert: (code: string) => Promise<AppCredentials>;
  /**
   * Arm a user-driven abort (production: {@link abortOnEnter}); the flow calls `abort` to cancel
   * and disposes the returned handle when it settles. Omitted ⇒ no abort (the flow waits for the
   * browser callback, and Ctrl-C is the only way out). A fire-and-forget opener can't tell us the
   * browser was closed, so this keypress is how the user says "I gave up".
   */
  onAbort?: (abort: () => void) => () => void;
  /** Optional safety bound; omitted in production so the flow waits for the browser callback. */
  timeoutMs?: number;
}

// GitHub echoes `state` back on the redirect_url callback only when it rode in as a query
// param on the manifest action URL — so bind it here, not just on the local page-load URL.
function createAction(target: ManifestFlowDeps['target'], state: string): string {
  const base =
    target.kind === 'org'
      ? `https://github.com/organizations/${target.org}/settings/apps/new`
      : 'https://github.com/settings/apps/new';
  return `${base}?state=${encodeURIComponent(state)}`;
}

/** Let the user abort the browser handshake by pressing Enter. Returns a disposer. No-op when
 *  stdin isn't a TTY (nothing to read — the flow just waits for the callback). */
export function abortOnEnter(abort: () => void): () => void {
  if (!process.stdin.isTTY) return () => {};
  const onData = (): void => abort();
  process.stdin.once('data', onData);
  process.stdin.resume();
  return () => {
    process.stdin.off('data', onData);
    process.stdin.pause();
  };
}

/**
 * Run the loopback App-Manifest handshake (spec §3.2). Binds 127.0.0.1 on an ephemeral port,
 * serves a self-POST form carrying the manifest + a loopback `redirect_url`, captures the
 * single-use `code` on `/callback` (verifying `state`), converts it, and returns the App id +
 * pem + slug. The code never leaves the machine; the server is single-shot.
 */
export function runManifestFlow(deps: ManifestFlowDeps): Promise<AppCredentials> {
  const state = randomBytes(16).toString('hex');

  return new Promise<AppCredentials>((resolve, reject) => {
    let port = 0;
    let settled = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/') {
        const manifest = { ...deps.manifest, redirect_url: `http://127.0.0.1:${port}/callback` };
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(formPage(createAction(deps.target, state), manifest));
        return;
      }
      if (url.pathname === '/callback') {
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400).end('state mismatch');
          return fail(
            new SetupError(
              'the browser callback failed its state (CSRF) check',
              'Re-run setup and use the browser window it opens — don’t reuse an old tab.',
            ),
          );
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400).end('missing code');
          return fail(
            new SetupError(
              'the browser callback carried no App code',
              'Re-run setup and complete the “Create GitHub App” step in the page it opens.',
            ),
          );
        }
        deps.convert(code).then(
          (creds) => {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(
              donePage(
                `https://github.com/apps/${creds.slug}/installations/new`,
                deps.repoFullName ?? 'this repository',
              ),
            );
            succeed(creds);
          },
          (err) => {
            res.writeHead(500).end('conversion failed');
            fail(err instanceof Error ? err : new Error(String(err)));
          },
        );
        return;
      }
      res.writeHead(404).end();
    });

    const timer = deps.timeoutMs
      ? setTimeout(
          () =>
            fail(
              new SetupError(
                'timed out waiting for the browser step',
                'Re-run setup and complete the two browser steps.',
              ),
            ),
          deps.timeoutMs,
        )
      : undefined;
    let disposeAbort: (() => void) | undefined;
    function teardown(): void {
      settled = true;
      if (timer) clearTimeout(timer);
      disposeAbort?.();
      server.close();
      // The browser leaves idle sockets to the loopback (preconnects, or the form-page socket
      // after it navigates away) with no request in flight. server.close() waits on those forever,
      // so the CLI would hang after "secrets written" — drop them and let the process exit.
      server.closeAllConnections();
    }
    function fail(err: Error): void {
      if (settled) return;
      teardown();
      reject(err);
    }
    function succeed(creds: AppCredentials): void {
      if (settled) return;
      teardown();
      resolve(creds);
    }

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      disposeAbort = deps.onAbort?.(() =>
        fail(
          new SetupError(
            'setup cancelled before the browser step finished',
            'Re-run when you’re ready to complete the two browser steps.',
          ),
        ),
      );
      deps.openBrowser(`http://127.0.0.1:${port}/?state=${state}`).catch(fail);
    });
  });
}
