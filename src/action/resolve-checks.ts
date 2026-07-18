import type { getOctokit } from '@actions/github';
import { CONFIG_FILENAME, parseConfig } from '../engine/config.ts';
import { fileAtRef } from '../git.ts';
import { discoverRequiredChecks } from './discover-checks.ts';

type Octokit = ReturnType<typeof getOctokit>;

/** The reviewer's own check-run name; never part of its own backstop set (spec §2.4). */
const WAIVER_STAMP_CHECK = 'waiver-stamp';

export interface ResolvedChecks {
  /** Check-run names that must be green on the head SHA (waiver-stamp self-excluded). */
  required: string[];
  /** Whether a required lockfile-honesty check is present (silences the APPROVE caveat). */
  lockfileHonestyConfigured: boolean;
}

/**
 * Resolve the reviewer's required-check set (autodiscovered from base-branch protection, with
 * the `ci-checks` input as the no-App fallback) and the honesty flag (a base-config-named
 * required check silences the APPROVE caveat — fail-safe: only a positive match silences it).
 */
export function makeResolveRequiredChecks(inputs: {
  ciChecks: string[];
  lockfileHonestyChecks: string[];
}) {
  return async (
    octokit: Octokit,
    args: { owner: string; repo: string; base: string; repoDir: string },
  ): Promise<ResolvedChecks> => {
    const discovered = await discoverRequiredChecks(octokit, args.owner, args.repo, args.base);
    const set = discovered.length > 0 ? discovered : inputs.ciChecks;
    const required = set.filter((name) => name !== WAIVER_STAMP_CHECK);

    const config = parseConfig(await fileAtRef(args.repoDir, args.base, CONFIG_FILENAME));
    const honesty = config.lockfileHonestyCheck;
    const lockfileHonestyConfigured = honesty !== undefined && required.includes(honesty);

    return { required, lockfileHonestyConfigured };
  };
}
