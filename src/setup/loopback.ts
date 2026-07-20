import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
  openBrowser: (url: string) => Promise<void>;
  convert: (code: string) => Promise<AppCredentials>;
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

/**
 * Run the loopback App-Manifest handshake (spec §3.2). Binds 127.0.0.1 on an ephemeral port,
 * serves a self-POST form carrying the manifest + a loopback `redirect_url`, captures the
 * single-use `code` on `/callback` (verifying `state`), converts it, and returns the App id +
 * pem + slug. The code never leaves the machine; the server is single-shot and short-lived.
 */
export function runManifestFlow(deps: ManifestFlowDeps): Promise<AppCredentials> {
  const state = randomBytes(16).toString('hex');
  const timeoutMs = deps.timeoutMs ?? 5 * 60_000;

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
          return fail(new Error('manifest flow: state mismatch (possible CSRF) — aborting'));
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400).end('missing code');
          return fail(new Error('manifest flow: no code in callback'));
        }
        deps.convert(code).then(
          (creds) => {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(donePage(`https://github.com/apps/${creds.slug}/installations/new`));
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

    const timer = setTimeout(
      () => fail(new Error('manifest flow: timed out waiting for the browser callback')),
      timeoutMs,
    );
    function teardown(): void {
      settled = true;
      clearTimeout(timer);
      server.close();
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
      deps.openBrowser(`http://127.0.0.1:${port}/?state=${state}`).catch(fail);
    });
  });
}
