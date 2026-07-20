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
  repos?: string[];
}

export interface GhClient {
  listOrgs(): Promise<string[]>;
  setSecret(a: SetSecretArgs): Promise<void>;
  appConversion(code: string): Promise<AppConversion>;
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
      if (a.scope === 'org') {
        if (!a.org)
          throw new SetupError(
            'org-scope secret needs an org',
            'Report this — internal wiring bug.',
          );
        // `--repos` grants the org secret to specific repositories. gh accepts the bare repo
        // name for org secrets; we pass `owner/repo` for symmetry with the repo scope. Only
        // exercised for org targets (the personal/repo path is what the E2E covers), so revisit
        // the bare-name vs owner/repo form when the org path is first run for real.
        const repos = a.repos ?? (a.repo ? [a.repo] : []);
        args.push('--org', a.org, '--repos', repos.join(','));
      } else {
        if (!a.repo)
          throw new SetupError(
            'repo-scope secret needs a repo',
            'Report this — internal wiring bug.',
          );
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
    async appConversion(code) {
      const r = await run('gh', ['api', '-X', 'POST', `/app-manifests/${code}/conversions`]);
      // The manifest code is single-use and short-lived; a slow browser step makes this the most
      // likely failure in the flow. Fail closed with a remediation rather than letting JSON.parse
      // throw a cryptic error or emit undefined creds that then get written as secrets.
      if (r.code !== 0)
        throw new SetupError(
          'GitHub App creation did not complete',
          r.stderr.trim() ||
            'The one-time setup code may have expired — re-run and complete the browser step promptly.',
        );
      const j = JSON.parse(r.stdout) as { id?: number; pem?: string; slug?: string };
      if (typeof j.id !== 'number' || !j.pem || !j.slug)
        throw new SetupError(
          'GitHub App conversion returned no credentials',
          'Re-run setup; if it recurs, report the `gh api /app-manifests/.../conversions` response.',
        );
      return { appId: j.id, pem: j.pem, slug: j.slug };
    },
  };
}
