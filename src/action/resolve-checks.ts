import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

/** What the reviewer needs to run the backstop and decide the honesty caveat. */
export interface ResolvedChecks {
  /** Check-run names that must be green on the head SHA (waiver-stamp self-excluded). */
  required: string[];
  /** Whether a required lockfile-honesty check is present (silences the APPROVE caveat). */
  lockfileHonestyConfigured: boolean;
}

/**
 * Resolve the reviewer's required-check set and honesty flag. The factory closes over the
 * action inputs; the returned function takes the per-run context (PR 1 reads required-check
 * config from `octokit`/`args`; this PR-0 body returns the static inputs unchanged).
 */
export function makeResolveRequiredChecks(inputs: {
  ciChecks: string[];
  lockfileHonestyChecks: string[];
}) {
  return async (
    _octokit: Octokit,
    _args: { owner: string; repo: string; base: string; repoDir: string },
  ): Promise<ResolvedChecks> => ({
    required: [...inputs.ciChecks, ...inputs.lockfileHonestyChecks],
    lockfileHonestyConfigured: inputs.lockfileHonestyChecks.length > 0,
  });
}
