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

/** `all` = every repo in the org, `private` = every private repo, `selected` = an explicit list. */
export type SecretVisibility = 'all' | 'private' | 'selected';

export interface OrgSecret {
  name: string;
  visibility: SecretVisibility;
}

/** A repo ruleset as listed — only the name matters for the idempotency check (§4.6). */
export interface RulesetSummary {
  name: string;
}

/** The dedicated `waiver-stamp` ruleset we create: one required check on the default branch. */
export interface RulesetSpec {
  name: string;
  target: 'branch';
  enforcement: 'active';
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: Array<{
    type: 'required_status_checks';
    parameters: {
      strict_required_status_checks_policy: boolean;
      required_status_checks: Array<{ context: string }>;
    };
  }>;
}

export interface GhClient {
  listOrgs(): Promise<string[]>;
  /** The authenticated user's login, or `null` when it can't be read. */
  viewerLogin(): Promise<string | null>;
  /** Whether `login` is a user or an organization; `null` when unreadable or neither. */
  accountType(login: string): Promise<'User' | 'Organization' | null>;
  setSecret(a: SetSecretArgs): Promise<void>;
  appConversion(code: string): Promise<AppConversion>;
  /** OAuth scopes on the active `gh` token (from the `X-Oauth-Scopes` header). Empty when the
   *  token exposes none (e.g. fine-grained PATs) — i.e. its scopes can't be proven. */
  tokenScopes(): Promise<string[]>;
  /** The org's Actions secrets — their presence is the reuse signal (§4.3). Empty when
   *  unreadable. `visibility` decides whether a repo needs an explicit grant to read one. */
  orgSecrets(org: string): Promise<OrgSecret[]>;
  /** Names of the repo's own Actions secrets (org-scope ones don't appear). Empty when
   *  unreadable — the caller then provisions, which is the safe direction. */
  repoSecretNames(repoFullName: string): Promise<string[]>;
  /** Add a repo to an org secret's selected-repositories list, without knowing its value. */
  grantOrgSecretRepo(org: string, name: string, repoFullName: string): Promise<void>;
  /** Slugs of the Apps installed on the org. Empty when unreadable. */
  orgAppSlugs(org: string): Promise<string[]>;
  /** The repo's rulesets — presence of one named `waiver-stamp` is the idempotency signal (§4.6). */
  listRulesets(owner: string, repo: string): Promise<RulesetSummary[]>;
  /** Create a repo ruleset from `spec`. */
  createRuleset(owner: string, repo: string, spec: RulesetSpec): Promise<void>;
  /** Whether `path` exists on `ref` — the §4.13 phase-boundary gate reads the producer caller on
   *  the default branch (the `waiver-stamp` check only reports on PRs, never on default-branch
   *  commits, so its presence there is the real "safe to require it" signal). */
  fileExistsOnRef(owner: string, repo: string, path: string, ref: string): Promise<boolean>;
}

const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

type Run = (cmd: string, args: string[], opts?: { input?: string }) => Promise<RunResult>;

export function makeGh(run: Run): GhClient {
  return {
    async listOrgs() {
      const r = await run('gh', ['api', 'user/orgs', '--jq', '.[].login']);
      return lines(r.stdout);
    },
    async viewerLogin() {
      const r = await run('gh', ['api', 'user', '--jq', '.login']);
      return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    },
    async accountType(login) {
      const r = await run('gh', ['api', `/users/${login}`, '--jq', '.type']);
      const t = r.code === 0 ? r.stdout.trim() : '';
      return t === 'User' || t === 'Organization' ? t : null;
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
    // Both org reads degrade to [] rather than throwing: a token that can't list them still
    // provisions fine, it just doesn't get the reuse short-circuit.
    async orgSecrets(org) {
      const r = await run('gh', [
        'api',
        `/orgs/${org}/actions/secrets`,
        '--paginate',
        '--jq',
        '.secrets[] | [.name, .visibility] | @tsv',
      ]);
      if (r.code !== 0) return [];
      return lines(r.stdout).flatMap((l) => {
        const [name, visibility] = l.split('\t');
        return name && visibility ? [{ name, visibility: visibility as SecretVisibility }] : [];
      });
    },
    async repoSecretNames(repoFullName) {
      const r = await run('gh', [
        'api',
        `/repos/${repoFullName}/actions/secrets`,
        '--paginate',
        '--jq',
        '.secrets[].name',
      ]);
      return r.code === 0 ? lines(r.stdout) : [];
    },
    async orgAppSlugs(org) {
      const r = await run('gh', [
        'api',
        `/orgs/${org}/installations`,
        '--paginate',
        '--jq',
        '.installations[].app_slug',
      ]);
      return r.code === 0 ? lines(r.stdout) : [];
    },
    async grantOrgSecretRepo(org, name, repoFullName) {
      // The API takes a numeric repository id, not `owner/repo`.
      const id = await run('gh', ['api', `/repos/${repoFullName}`, '--jq', '.id']);
      const r =
        id.code === 0
          ? await run('gh', [
              'api',
              '-X',
              'PUT',
              `/orgs/${org}/actions/secrets/${name}/repositories/${id.stdout.trim()}`,
            ])
          : id;
      if (r.code !== 0)
        throw new SetupError(
          `failed to grant ${repoFullName} access to the org secret ${name}`,
          `Add it by hand under https://github.com/organizations/${org}/settings/secrets/actions, then re-run.`,
          r.stderr.trim() || r.stdout.trim() || undefined,
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
    async listRulesets(owner, repo) {
      const r = await run('gh', [
        'api',
        `/repos/${owner}/${repo}/rulesets`,
        '--paginate',
        '--jq',
        '.[].name',
      ]);
      return r.code === 0 ? lines(r.stdout).map((name) => ({ name })) : [];
    },
    async createRuleset(owner, repo, spec) {
      // `--input -` sends the ruleset JSON on stdin, keeping the payload out of argv.
      const r = await run(
        'gh',
        ['api', '-X', 'POST', `/repos/${owner}/${repo}/rulesets`, '--input', '-'],
        {
          input: JSON.stringify(spec),
        },
      );
      if (r.code !== 0)
        throw new SetupError(
          'failed to create the waiver-stamp ruleset',
          `Add a branch ruleset on ${owner}/${repo} requiring the "waiver-stamp" check by hand, then re-run.`,
          r.stderr.trim() || r.stdout.trim() || undefined,
        );
    },
    async fileExistsOnRef(owner, repo, path, ref) {
      const r = await run('gh', [
        'api',
        `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
        '--silent',
      ]);
      return r.code === 0;
    },
  };
}
