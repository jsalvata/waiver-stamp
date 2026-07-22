import { createHash } from 'node:crypto';

export interface AppManifest {
  name: string;
  url: string;
  public: false;
  default_permissions: { contents: 'write'; pull_requests: 'write'; administration: 'read' };
  default_events: [];
  redirect_url?: string;
}

const NAME_CAP = 34; // GitHub App names must be ≤ 34 chars.

/**
 * Deterministic, slug-safe App name (spec §3.1): `waiver-stamp-<owner>` for an App the owner
 * reuses across repos, or `waiver-stamp-<owner>-<repo>` when it's dedicated to one.
 *
 * The two must differ because App names are globally unique: an owner who declined to save their
 * key already holds the account-wide name from an earlier repo, so a dedicated App has to ask for
 * a different one or GitHub's create page rejects it.
 */
export function appSlugName(owner: string, repo?: string): string {
  const source = repo ? `${owner}-${repo}` : owner;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const full = `waiver-stamp-${slug}`;
  if (full.length <= NAME_CAP) return full;
  // Hash the untruncated source so two long names that share a prefix stay distinct.
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 6);
  const keep = NAME_CAP - 'waiver-stamp-'.length - hash.length - 1;
  return `waiver-stamp-${slug.slice(0, keep)}-${hash}`;
}

/**
 * The App-Manifest object (spec §3.1). `redirect_url` is filled per-run by the loopback flow.
 * Passing `repo` names the App after it, marking it as dedicated to that one repository.
 */
export function buildManifest(args: {
  owner: string;
  appUrl: string;
  repo?: string;
}): AppManifest {
  return {
    name: appSlugName(args.owner, args.repo),
    url: args.appUrl,
    public: false,
    default_permissions: { contents: 'write', pull_requests: 'write', administration: 'read' },
    default_events: [],
  };
}
