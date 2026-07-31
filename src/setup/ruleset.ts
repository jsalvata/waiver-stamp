import type { GhClient } from './gh.ts';

/**
 * Add a dedicated `waiver-stamp` ruleset requiring only the `waiver-stamp` check on the default
 * branch (§4.6). Rulesets aggregate, so this layers with the adopter's existing protection rather
 * than replacing it. Idempotent: an existing ruleset of that name is left as-is.
 */
export async function ensureWaiverStampRuleset(
  gh: GhClient,
  args: { owner: string; repo: string; defaultBranch: string },
): Promise<'created' | 'exists'> {
  const existing = await gh.listRulesets(args.owner, args.repo);
  if (existing.some((r) => r.name === 'waiver-stamp')) return 'exists';
  await gh.createRuleset(args.owner, args.repo, {
    name: 'waiver-stamp',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [`refs/heads/${args.defaultBranch}`], exclude: [] } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: 'waiver-stamp' }],
        },
      },
    ],
  });
  return 'created';
}
