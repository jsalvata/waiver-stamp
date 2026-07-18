import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

interface BranchRule {
  type: string;
  parameters?: { required_status_checks?: Array<{ context: string }> };
}

/**
 * The required status-check contexts for `base`, read from the rulesets endpoint (which
 * surfaces both classic protection and rulesets), falling back to classic protection when the
 * rules endpoint yields none. Both reads need repo-config read access — in the setup-produced
 * config the action's token is the App token with `administration: read` (spec §2.6). Any read
 * error is swallowed to `[]`; an empty set is fail-closed upstream (no-op, never approve).
 */
export async function discoverRequiredChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
): Promise<string[]> {
  const fromRules = await readRules(octokit, owner, repo, base);
  if (fromRules.length > 0) return fromRules;
  return readClassic(octokit, owner, repo, base);
}

async function readRules(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string[]> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', {
      owner,
      repo,
      branch,
    });
    const rules = data as BranchRule[];
    const contexts = rules
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c.context);
    return [...new Set(contexts)];
  } catch {
    return [];
  }
}

async function readClassic(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string[]> {
  try {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks',
      { owner, repo, branch },
    );
    return (data as { contexts?: string[] }).contexts ?? [];
  } catch {
    return [];
  }
}
