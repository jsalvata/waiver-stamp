interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export async function confirmChecksGreen(
  octokit: { paginate: (route: unknown, params: unknown) => Promise<CheckRun[]> } & {
    rest: { checks: { listForRef: unknown } };
  },
  args: { owner: string; repo: string; headSha: string; required: readonly string[] },
): Promise<{ ok: boolean; pending: string[]; failed: string[] }> {
  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner: args.owner,
    repo: args.repo,
    ref: args.headSha,
    per_page: 100,
  });
  const latest = new Map<string, CheckRun>(); // newest run wins per name
  for (const run of runs) latest.set(run.name, run);

  const pending: string[] = [];
  const failed: string[] = [];
  for (const name of args.required) {
    const run = latest.get(name);
    if (!run || run.status !== 'completed') pending.push(name);
    else if (run.conclusion !== 'success') failed.push(name);
  }
  return { ok: pending.length === 0 && failed.length === 0, pending, failed };
}
