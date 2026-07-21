import { SetupError } from './errors.ts';
import type { RunResult } from './run.ts';

export interface AppConversion {
  appId: number;
  pem: string;
  slug: string;
}

export interface SetSecretArgs {
  name: string;
  value: string;
  scope: 'repo' | 'org';
  repo?: string;
  org?: string;
}

export interface GhClient {
  listOrgs(): Promise<string[]>;
  setSecret(a: SetSecretArgs): Promise<void>;
  appConversion(code: string): Promise<AppConversion>;
  /** OAuth scopes on the active `gh` token (from the `X-Oauth-Scopes` header). Empty when the
   *  token exposes none (e.g. fine-grained PATs) — i.e. its scopes can't be proven. */
  tokenScopes(): Promise<string[]>;
}

type Run = (cmd: string, args: string[], opts?: { input?: string }) => Promise<RunResult>;

export function makeGh(run: Run): GhClient {
  return {
    async listOrgs() {
      const r = await run('gh', ['api', 'user/orgs', '--jq', '.[].login']);
      return r.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    },
    async setSecret(a) {
      const args = ['secret', 'set', a.name];
      if (!a.repo)
        throw new SetupError('secret needs a repo', 'Report this — internal wiring bug.');
      if (a.scope === 'org') {
        if (!a.org)
          throw new SetupError(
            'org-scope secret needs an org',
            'Report this — internal wiring bug.',
          );
        args.push('--org', a.org, '--repos', a.repo);
      } else {
        args.push('--repo', a.repo);
      }
      // No `--body`: `gh secret set` reads the value from stdin when unspecified. Passing the pem
      // via stdin (not argv) keeps it out of the process table.
      const r = await run('gh', args, { input: a.value });
      if (r.code !== 0)
        throw new SetupError(
          `failed to set secret ${a.name}`,
          r.stderr.trim() || 'Check `gh auth status` and that you can administer the repository.',
        );
    },
    async tokenScopes() {
      const r = await run('gh', ['api', '-i', 'user']);
      if (r.code !== 0) return [];
      const line = r.stdout.split('\n').find((l) => /^x-oauth-scopes:/i.test(l));
      if (!line) return [];
      return line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    },
    async appConversion(code) {
      const r = await run('gh', ['api', '-X', 'POST', `/app-manifests/${code}/conversions`]);
      // The manifest code is single-use and short-lived; a slow browser step makes this the most
      // likely failure in the flow. Fail closed with a remediation rather than letting JSON.parse
      // throw a cryptic error or emit undefined creds that then get written as secrets.
      if (r.code !== 0)
        throw new SetupError(
          'GitHub App creation did not complete',
          'The one-time setup code may have expired — re-run and complete the browser step promptly. If it recurs, report the details at https://github.com/jsalvata/waiver-stamp/issues.',
          r.stderr.trim() || r.stdout.trim() || undefined,
        );
      const j = JSON.parse(r.stdout) as { id?: number; pem?: string; slug?: string };
      if (typeof j.id !== 'number' || !j.pem || !j.slug)
        throw new SetupError(
          'GitHub App conversion returned no credentials',
          'Re-run setup; if it recurs, report the details at https://github.com/jsalvata/waiver-stamp/issues.',
          r.stdout.trim(),
        );
      return { appId: j.id, pem: j.pem, slug: j.slug };
    },
  };
}
