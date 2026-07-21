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

  it('viewerLogin reads the authenticated login', async () => {
    const run = mockRun(async () => ok('jsalvata\n'));
    const gh = makeGh(run);
    expect(await gh.viewerLogin()).toBe('jsalvata');
    expect(run).toHaveBeenCalledWith('gh', ['api', 'user', '--jq', '.login']);
  });

  it('accountType distinguishes an org from a user', async () => {
    const run = mockRun(async () => ok('Organization\n'));
    const gh = makeGh(run);
    expect(await gh.accountType('acme')).toBe('Organization');
    expect(run).toHaveBeenCalledWith('gh', ['api', '/users/acme', '--jq', '.type']);
  });

  // Anything we can't read is `null`, not a guess: the caller has to fail loudly rather than mint
  // an App on the wrong account.
  it('viewerLogin and accountType return null when the read fails', async () => {
    const run = mockRun(async () => ({ stdout: '', stderr: 'HTTP 404', code: 1 }));
    expect(await makeGh(run).viewerLogin()).toBeNull();
    expect(await makeGh(run).accountType('nope')).toBeNull();
  });

  it('accountType returns null on an unrecognised type', async () => {
    const run = mockRun(async () => ok('Mannequin\n'));
    expect(await makeGh(run).accountType('ghost')).toBeNull();
  });

  it('orgSecrets lists the org Actions secrets with their visibility', async () => {
    const run = mockRun(async () =>
      ok('WAIVER_STAMP_APP_ID\tselected\nWAIVER_STAMP_APP_PRIVATE_KEY\tall\n'),
    );
    const gh = makeGh(run);
    expect(await gh.orgSecrets('acme')).toEqual([
      { name: 'WAIVER_STAMP_APP_ID', visibility: 'selected' },
      { name: 'WAIVER_STAMP_APP_PRIVATE_KEY', visibility: 'all' },
    ]);
    expect(run).toHaveBeenCalledWith('gh', [
      'api',
      '/orgs/acme/actions/secrets',
      '--paginate',
      '--jq',
      '.secrets[] | [.name, .visibility] | @tsv',
    ]);
  });

  it('orgSecrets returns [] when the read fails rather than throwing', async () => {
    const run = mockRun(async () => ({ stdout: '', stderr: 'HTTP 403', code: 1 }));
    expect(await makeGh(run).orgSecrets('acme')).toEqual([]);
  });

  it('grantOrgSecretRepo resolves the repo id, then PUTs it onto the secret', async () => {
    const run = mockRun(async (_c, args) => ok(args.includes('/repos/acme/demo') ? '12345' : ''));
    const gh = makeGh(run);
    await gh.grantOrgSecretRepo('acme', 'WAIVER_STAMP_APP_ID', 'acme/demo');
    expect(run.mock.calls[0]?.[1]).toEqual(['api', '/repos/acme/demo', '--jq', '.id']);
    expect(run.mock.calls[1]?.[1]).toEqual([
      'api',
      '-X',
      'PUT',
      '/orgs/acme/actions/secrets/WAIVER_STAMP_APP_ID/repositories/12345',
    ]);
  });

  it('grantOrgSecretRepo raises a SetupError the user can act on', async () => {
    const run = mockRun(async (_c, args) =>
      args.includes('/repos/acme/demo')
        ? ok('12345')
        : { stdout: '', stderr: 'HTTP 404: Not Found', code: 1 },
    );
    await expect(
      makeGh(run).grantOrgSecretRepo('acme', 'WAIVER_STAMP_APP_ID', 'acme/demo'),
    ).rejects.toMatchObject({ name: 'SetupError', details: 'HTTP 404: Not Found' });
  });

  it('orgAppSlugs lists the app slugs installed on the org', async () => {
    const run = mockRun(async () => ok('waiver-stamp-acme\ndependabot\n'));
    const gh = makeGh(run);
    expect(await gh.orgAppSlugs('acme')).toEqual(['waiver-stamp-acme', 'dependabot']);
    expect(run).toHaveBeenCalledWith('gh', [
      'api',
      '/orgs/acme/installations',
      '--paginate',
      '--jq',
      '.installations[].app_slug',
    ]);
  });

  it('orgAppSlugs returns [] when the read fails — the install link just degrades', async () => {
    const run = mockRun(async () => ({ stdout: '', stderr: 'HTTP 403', code: 1 }));
    expect(await makeGh(run).orgAppSlugs('acme')).toEqual([]);
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
