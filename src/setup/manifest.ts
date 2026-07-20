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

/** Deterministic, slug-safe `waiver-stamp-<owner>` (the global-namespace reuse key, spec §3.1). */
export function appSlugName(owner: string): string {
  const slug = owner
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const full = `waiver-stamp-${slug}`;
  if (full.length <= NAME_CAP) return full;
  const hash = createHash('sha256').update(owner).digest('hex').slice(0, 6);
  const keep = NAME_CAP - 'waiver-stamp-'.length - hash.length - 1;
  return `waiver-stamp-${slug.slice(0, keep)}-${hash}`;
}

/** The App-Manifest object (spec §3.1). `redirect_url` is filled per-run by the loopback flow. */
export function buildManifest(args: { owner: string; appUrl: string }): AppManifest {
  return {
    name: appSlugName(args.owner),
    url: args.appUrl,
    public: false,
    default_permissions: { contents: 'write', pull_requests: 'write', administration: 'read' },
    default_events: [],
  };
}
