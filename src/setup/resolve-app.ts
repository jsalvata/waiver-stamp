import { readDiskApp, writeDiskApp } from './disk.ts';
import type { GhClient } from './gh.ts';
import type { AppCredentials } from './loopback.ts';
import { type InstallTarget, provisionAppFresh } from './provision-app.ts';
import { SECRET_NAMES } from './secrets.ts';

/** Where the App came from — drives what the orchestrator does with secrets afterwards. */
export type AppSource = 'reuse-org' | 'disk' | 'fresh';

export interface ResolvedApp {
  source: AppSource;
  /** Absent on `reuse-org` when the installation isn't visible (the install link degrades). */
  slug?: string;
  /** Absent on `reuse-org`: org secrets already carry the key and it can't be re-read. */
  appId?: number;
  pem?: string;
}

export interface ResolveAppDeps {
  target: InstallTarget;
  owner: string;
  repo: string;
  gh: GhClient;
  openBrowser: (url: string) => Promise<void>;
  /** Ask whether to persist the personal key to disk (§4.4). Default is no — D10. */
  confirmSaveKey: () => Promise<boolean>;
  info: (msg: string) => void;
  provisionAppFresh?: typeof provisionAppFresh;
  readDiskApp?: typeof readDiskApp;
  writeDiskApp?: typeof writeDiskApp;
}

/**
 * Pick the App to use: reuse an org install, load a saved personal key, or mint a fresh one
 * (spec §4.3, in that order).
 *
 * Neither reuse path keys on the App's *name*. The org path keys on the org secrets existing and
 * the personal path on the slug recorded at creation time — so an adopter who renames the App on
 * GitHub's create form still gets reuse instead of a silent duplicate.
 */
export async function resolveApp(deps: ResolveAppDeps): Promise<ResolvedApp> {
  const fresh = deps.provisionAppFresh ?? provisionAppFresh;
  const read = deps.readDiskApp ?? readDiskApp;
  const write = deps.writeDiskApp ?? writeDiskApp;

  if (deps.target.kind === 'org') {
    const existing = (await deps.gh.orgSecrets(deps.target.org)).map((s) => s.name);
    if (SECRET_NAMES.every((n) => existing.includes(n))) {
      const slug = (await deps.gh.orgAppSlugs(deps.target.org)).find((s) =>
        s.startsWith('waiver-stamp-'),
      );
      deps.info(`Reusing the App already configured for ${deps.target.org} — no new key needed.`);
      return slug ? { source: 'reuse-org', slug } : { source: 'reuse-org' };
    }
    return { ...(await runFresh()), source: 'fresh' };
  }

  const saved = await read(deps.owner);
  if (saved) {
    deps.info(`Reusing the App saved for ${deps.owner} — no browser step needed.`);
    return { ...saved, source: 'disk' };
  }

  const save = await deps.confirmSaveKey();
  const creds = await runFresh();
  if (save) await write(deps.owner, creds);
  return { ...creds, source: 'fresh' };

  function runFresh(): Promise<AppCredentials> {
    return fresh({
      target: deps.target,
      owner: deps.owner,
      repo: deps.repo,
      gh: deps.gh,
      openBrowser: deps.openBrowser,
    });
  }
}
