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

/**
 * Resolution/install inputs — files that change what `pnpm install` executes
 * (hooks, registries, patches, alternative manifests). Unlike MANIFESTS these have
 * no "honest bump" envelope: any PR commit touching one is refused, fail-closed,
 * mirroring G1's per-commit scan. Matched by basename so nested copies count too.
 * Kept in sync with lockfile-assay's isResolutionInput.
 */
function isResolutionInput(f: string): boolean {
  const base = f.slice(f.lastIndexOf('/') + 1);
  if (base === '.pnpmfile.cjs' || base === '.npmrc') return true;
  if (base === 'pnpm-workspace.yaml') return true;
  if (base === 'package.yaml' || base === 'package.json5') return true;
  if (base.endsWith('.patch') || base.endsWith('.diff')) return true;
  // pnpm's default patchedDependencies location, at any depth
  return f.startsWith('patches/') || f.includes('/patches/');
}

export async function g2DependencyIntegrity(
  repo: string,
  base: string,
  head: string,
): Promise<string[]> {
  const violations: string[] = [];

  // (a) Fail-closed, per-commit: any commit that introduces a resolution input.
  //     No envelope to validate — mirrors G1's per-commit semantics (a later revert
  //     does not un-refuse it; the poisoned install already ran in the producer).
  for (const sha of await commitsInRange(repo, base, head)) {
    if ((await parents(repo, sha)).length !== 1) continue; // merges skipped upstream
    for (const f of await changedFiles(repo, `${sha}^`, sha)) {
      if (isResolutionInput(f)) violations.push(`${sha.slice(0, 7)} touches resolution input ${f}`);
    }
  }

  // (b) Net-diff envelope for package.json/pnpm-lock.yaml (unchanged behaviour). The
  //     MANIFESTS short-circuit still skips the (expensive) worktree checkout when no
  //     manifest moved — safe now that (a) independently covers the resolution inputs.
  if ((await changedFiles(repo, base, head)).some((f) => MANIFESTS.includes(f))) {
    const baseTree = await worktreeAt(repo, base);
    const headTree = await worktreeAt(repo, head);
    try {
      const cfg = await loadConfig(baseTree.dir);
      const basePkg = await readJson(`${baseTree.dir}/package.json`);
      const headPkg = await readJson(`${headTree.dir}/package.json`);
      violations.push(...manifestBumpViolations(basePkg, headPkg, cfg.allowBumping ?? []));
    } finally {
      await baseTree.cleanup();
      await headTree.cleanup();
    }
  }

  return violations;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}
