import { type Socket, connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { runManifestFlow } from './loopback.ts';
import { buildManifest } from './manifest.ts';

describe('runManifestFlow', () => {
  it('captures the code on loopback, verifies state, converts, returns credentials', async () => {
    const manifest = buildManifest({
      owner: 'o',
      appUrl: 'https://github.com/jsalvata/waiver-stamp',
    });
    const convert = vi.fn(async (code: string) => {
      expect(code).toBe('abc123');
      return { appId: 42, pem: '-----BEGIN…', slug: 'waiver-stamp-o' };
    });
    const openBrowser = vi.fn(async (formUrl: string) => {
      const u = new URL(formUrl);
      const page = await fetch(formUrl).then((r) => r.text());
      expect(page).toContain('method="post"');
      // Mirror GitHub: it echoes `state` back only because it rode in on the form's action URL.
      // Read it from there (not the local page-load URL) so this fails if the action drops state.
      const action = page.match(/action="([^"]+)"/)?.[1] ?? '';
      const state = new URL(action).searchParams.get('state');
      expect(state).toBeTruthy();
      await fetch(`${u.origin}/callback?code=abc123&state=${state}`);
    });
    const creds = await runManifestFlow({
      target: { kind: 'personal' },
      manifest,
      repoFullName: 'jsalvata/waiver-stamp',
      openBrowser,
      convert,
    });
    expect(creds).toEqual({ appId: 42, pem: '-----BEGIN…', slug: 'waiver-stamp-o' });
    expect(convert).toHaveBeenCalledOnce();
  });

  it('closes lingering browser connections on success so the process can exit', async () => {
    const manifest = buildManifest({ owner: 'o', appUrl: 'https://x' });
    // A real browser leaves an idle TCP socket to the loopback (a preconnect, or the socket left
    // after the form page self-POSTs and navigates away) with no request in flight. server.close()
    // never reaps those, so the CLI hangs after "secrets written" — teardown must destroy them.
    let idle: Socket | undefined;
    const openBrowser = vi.fn(async (formUrl: string) => {
      const u = new URL(formUrl);
      const state = u.searchParams.get('state');
      idle = connect(Number(u.port), u.hostname);
      await new Promise<void>((r) => idle?.once('connect', () => r()));
      await fetch(`${u.origin}/callback?code=abc123&state=${state}`);
    });
    await runManifestFlow({
      target: { kind: 'personal' },
      manifest,
      openBrowser,
      convert: async () => ({ appId: 1, pem: 'p', slug: 's' }),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(idle?.destroyed).toBe(true);
    idle?.destroy();
  });

  it('rejects a callback whose state does not match (CSRF guard)', async () => {
    const manifest = buildManifest({ owner: 'o', appUrl: 'https://x' });
    const openBrowser = vi.fn(async (formUrl: string) => {
      await fetch(`${new URL(formUrl).origin}/callback?code=abc123&state=WRONG`);
    });
    await expect(
      runManifestFlow({
        target: { kind: 'personal' },
        manifest,
        openBrowser,
        convert: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: 'SetupError', message: expect.stringMatching(/state/i) });
  });

  it('rejects with a SetupError when the user aborts (no timeout needed)', async () => {
    const manifest = buildManifest({ owner: 'o', appUrl: 'https://x' });
    const err = await runManifestFlow({
      target: { kind: 'personal' },
      manifest,
      openBrowser: vi.fn(async () => {}), // never calls back — the user gives up instead
      convert: vi.fn(),
      onAbort: (abort) => {
        abort();
        return () => {};
      },
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'SetupError', message: expect.stringMatching(/cancel/i) });
  });
});
