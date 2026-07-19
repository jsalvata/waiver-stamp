import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

interface BranchRule {
  type: string;
  parameters?: { required_status_checks?: Array<{ context: string }> };
}

/**
 * The required status-check contexts for `base`, read from BOTH the rulesets endpoint and
 * classic branch protection and unioned — each surfaces only its own mechanism, and a repo can
 * require checks under either or both (e.g. classic CI checks plus a dedicated `waiver-stamp`
 * ruleset, which is exactly what our setup creates). Both reads need repo-config read access —
 * in the setup-produced config the action's token is the App token with `administration: read`
 * (spec §2.6). Each source's read error is swallowed to `[]`; an empty union is fail-closed
 * upstream (no-op, never approve).
 */
export async function discoverRequiredChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
): Promise<string[]> {
  const [fromRules, fromClassic] = await Promise.all([
    readRules(octokit, owner, repo, base),
    readClassic(octokit, owner, repo, base),
  ]);
  return [...new Set([...fromRules, ...fromClassic])];
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
