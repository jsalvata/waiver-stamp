import { describe, expect, it, vi } from 'vitest';
import { makeGh } from './gh.ts';
import type { RunResult } from './run.ts';

const ok = (stdout = ''): RunResult => ({ stdout, stderr: '', code: 0 });

type Run = (cmd: string, args: string[], opts?: { input?: string }) => Promise<RunResult>;
const mockRun = (impl: Run) => vi.fn<Run>(impl);

describe('makeGh', () => {
  it('listOrgs parses one login per line', async () => {
    const run = mockRun(async () => ok('acme\n widgets \n\n'));
    const gh = makeGh(run);
    expect(await gh.listOrgs()).toEqual(['acme', 'widgets']);
    expect(run).toHaveBeenCalledWith('gh', ['api', 'user/orgs', '--jq', '.[].login']);
  });

  it('setSecret (repo scope) passes the value via stdin, never in argv, and omits --body', async () => {
    const run = mockRun(async () => ok());
    const gh = makeGh(run);
    await gh.setSecret({
      name: 'WAIVER_STAMP_APP_PRIVATE_KEY',
      value: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
      scope: 'repo',
      repo: 'o/r',
    });
    const [cmd, args, opts] = run.mock.calls[0] ?? [];
    expect(cmd).toBe('gh');
    expect(args).toEqual(['secret', 'set', 'WAIVER_STAMP_APP_PRIVATE_KEY', '--repo', 'o/r']);
    expect(args).not.toContain('--body');
    // The pem must never appear as an argv element (it would leak via the process table).
    expect((args as string[]).some((a) => a.includes('BEGIN PRIVATE KEY'))).toBe(false);
    expect(opts).toEqual({
      input: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    });
  });

  it('setSecret (org scope) targets --org and --repos', async () => {
    const run = mockRun(async () => ok());
    const gh = makeGh(run);
    await gh.setSecret({
      name: 'WAIVER_STAMP_APP_ID',
      value: '42',
      scope: 'org',
      org: 'acme',
      repo: 'acme/demo',
    });
    const [, args, opts] = run.mock.calls[0] ?? [];
    expect(args).toEqual([
      'secret',
      'set',
      'WAIVER_STAMP_APP_ID',
      '--org',
      'acme',
      '--repos',
      'acme/demo',
    ]);
    expect(args).not.toContain('--body');
    expect(opts).toEqual({ input: '42' });
  });

  it('setSecret throws SetupError with the stderr remediation on failure', async () => {
    const run = mockRun(async () => ({ stdout: '', stderr: 'HTTP 403 Forbidden', code: 1 }));
    const gh = makeGh(run);
    await expect(
      gh.setSecret({ name: 'WAIVER_STAMP_APP_ID', value: '1', scope: 'repo', repo: 'o/r' }),
    ).rejects.toMatchObject({ name: 'SetupError', remediation: 'HTTP 403 Forbidden' });
  });

  it('tokenScopes parses the X-Oauth-Scopes response header', async () => {
    const run = mockRun(async () =>
      ok('HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, admin:org, gist\r\n\r\n{"login":"x"}'),
    );
    const gh = makeGh(run);
    expect(await gh.tokenScopes()).toEqual(['repo', 'admin:org', 'gist']);
    expect(run).toHaveBeenCalledWith('gh', ['api', '-i', 'user']);
  });

  it('tokenScopes returns [] when the scopes header is absent (unprovable)', async () => {
    const run = mockRun(async () => ok('HTTP/2.0 200 OK\r\n\r\n{"login":"x"}'));
    expect(await makeGh(run).tokenScopes()).toEqual([]);
  });

  it('appConversion posts to the conversions endpoint and maps id → appId', async () => {
    const run = mockRun(async () =>
      ok(JSON.stringify({ id: 7, pem: '-----BEGIN…', slug: 'waiver-stamp-o' })),
    );
    const gh = makeGh(run);
    expect(await gh.appConversion('code123')).toEqual({
      appId: 7,
      pem: '-----BEGIN…',
      slug: 'waiver-stamp-o',
    });
    expect(run).toHaveBeenCalledWith('gh', [
      'api',
      '-X',
      'POST',
      '/app-manifests/code123/conversions',
    ]);
  });

  it('appConversion fails closed (SetupError) when the code has expired, carrying the response', async () => {
    const run = mockRun(async () => ({ stdout: '', stderr: 'HTTP 404: Not Found', code: 1 }));
    const gh = makeGh(run);
    const err = await gh.appConversion('stale').catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'SetupError', details: 'HTTP 404: Not Found' });
    // The raw response rides in `details` (structured), and the remediation says where to report.
    expect((err as { remediation: string }).remediation).toContain(
      'github.com/jsalvata/waiver-stamp/issues',
    );
  });
});
