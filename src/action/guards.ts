import { changedFiles, commitsInRange, parents } from '../git.ts';

/** SHAs in base..head whose own diff touches .github/** (per-commit, not net). */
export async function g1WorkflowIntegrity(
  repo: string,
  base: string,
  head: string,
): Promise<string[]> {
  const offenders: string[] = [];
  for (const sha of await commitsInRange(repo, base, head)) {
    if ((await parents(repo, sha)).length !== 1) continue; // merges are skipped upstream
    const files = await changedFiles(repo, `${sha}^`, sha);
    if (files.some((f) => f === '.github' || f.startsWith('.github/'))) offenders.push(sha);
  }
  return offenders;
}
