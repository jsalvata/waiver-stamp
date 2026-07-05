import { loadConfig } from '../engine/config.ts';
import { manifestBumpViolations } from '../engine/deps.ts';
import { changedFiles, commitsInRange, parents, worktreeAt } from '../git.ts';

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

const MANIFESTS = ['package.json', 'pnpm-lock.yaml'];

/** Empty if no manifest/lockfile changed, or the change stays within §6.3 gates 1–4. */
export async function g2ManifestEnvelope(
  repo: string,
  base: string,
  head: string,
): Promise<string[]> {
  const touched = (await changedFiles(repo, base, head)).some((f) => MANIFESTS.includes(f));
  if (!touched) return [];

  const baseTree = await worktreeAt(repo, base);
  const headTree = await worktreeAt(repo, head);
  try {
    const cfg = await loadConfig(baseTree.dir); // policy read from BASE
    const basePkg = await readJson(`${baseTree.dir}/package.json`);
    const headPkg = await readJson(`${headTree.dir}/package.json`);
    return manifestBumpViolations(basePkg, headPkg, cfg.allowBumping ?? []);
  } finally {
    await baseTree.cleanup();
    await headTree.cleanup();
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}
