import { access } from 'node:fs/promises';
import { type RepoContext, preflight } from '../setup/preflight.ts';
import { runCommand } from '../setup/run.ts';

export interface SetupOptions {
  yes?: boolean;
  target?: string;
  noApp?: boolean;
  cwd?: string;
}

export interface SetupDeps {
  preflight: (cwd: string) => Promise<RepoContext>;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Default wiring for the CLI (real shell + fs). PRs 4–6 extend this with provisioning deps. */
export function makeSetupDeps(): SetupDeps {
  return {
    preflight: (cwd) =>
      preflight(cwd, {
        run: runCommand,
        exists: async (p) =>
          access(p)
            .then(() => true)
            .catch(() => false),
      }),
    info: (m) => console.log(m),
    warn: (m) => console.warn(`warning: ${m}`),
  };
}

export async function setupRepository(opts: SetupOptions, deps: SetupDeps): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const ctx = await deps.preflight(cwd);
  deps.info(`waiver-stamp setup: ${ctx.owner}/${ctx.repo} (default branch ${ctx.defaultBranch})`);
  if (!ctx.pnpm)
    deps.warn('no pnpm-lock.yaml found — the dependency-bump op will be inert (spec §4.1).');
  deps.info(
    'Preflight OK. Repo provisioning (App, secrets, ruleset, workflows) lands in the next releases; see docs/auto-approval-setup.md for the manual steps until then.',
  );
}
