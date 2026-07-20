import { SetupError } from './errors.ts';
import type { RunResult } from './run.ts';

export interface PreflightDeps {
  run: (cmd: string, args: string[]) => Promise<RunResult>;
}
export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
}

const NOT_INSTALLED = 127;

export async function preflight(deps: PreflightDeps): Promise<RepoContext> {
  const inTree = await deps.run('git', ['rev-parse', '--is-inside-work-tree']);
  if (inTree.code === NOT_INSTALLED)
    throw new SetupError('git is not installed', 'Install Git and retry.');
  if (inTree.code !== 0 || inTree.stdout.trim() !== 'true')
    throw new SetupError(
      'not inside a git work tree',
      'Run this from inside your repository checkout.',
    );

  const remote = await deps.run('git', ['remote', 'get-url', 'origin']);
  const m = remote.stdout.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  const owner = m?.[1];
  const repo = m?.[2];
  if (remote.code !== 0 || !owner || !repo)
    throw new SetupError('no GitHub origin remote', 'Add a GitHub `origin` remote and retry.');

  const head = await deps.run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  const defaultBranch = head.stdout.trim().replace('refs/remotes/origin/', '') || 'main';

  const auth = await deps.run('gh', ['auth', 'status']);
  if (auth.code === NOT_INSTALLED)
    throw new SetupError(
      'gh is not installed',
      'Install the GitHub CLI (https://cli.github.com) and retry.',
    );
  if (auth.code !== 0)
    throw new SetupError(
      'gh is not authenticated',
      'Run `gh auth login` with an account that can administer this repository, then retry.',
    );

  return { owner, repo, defaultBranch };
}
