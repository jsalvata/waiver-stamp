import { CONFIG_FILENAME, parseConfig } from '../engine/config.ts';
import { manifestBumpViolations } from '../engine/deps.ts';
import { changedFiles, commitsInRange, fileAtRef, parents } from '../git.ts';

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
 * mirroring G1's per-commit scan. Basename-anchored; the pnpmfile hook matches at any
 * extension (`.pnpmfile.*`) and patch files by suffix anywhere. Deliberately a *superset*
 * of lockfile-assay's isResolutionInput — we refuse the whole category rather than
 * adjudicate it; keep the two in sync as pnpm's input surface grows.
 */
const RESOLUTION_INPUTS: RegExp[] = [
  /(^|\/)\.pnpmfile\./, // the hook, at any extension (.cjs/.mjs/.js/…)
  /(^|\/)\.npmrc$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)package\.(yaml|json5)$/,
  /\.(patch|diff)$/,
  /(^|\/)patches\//, // pnpm's default patchedDependencies dir, at any depth
];

function isResolutionInput(f: string): boolean {
  return RESOLUTION_INPUTS.some((re) => re.test(f));
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

  // (b) Net-diff envelope for package.json/pnpm-lock.yaml. Read only the 3 blobs the
  //     bump gates need via `git show` — no worktree, so the untrusted head tree is never
  //     materialized on disk. manifestBumpViolations deliberately never reads the lockfile.
  if ((await changedFiles(repo, base, head)).some((f) => MANIFESTS.includes(f))) {
    const cfg = parseConfig(await fileAtRef(repo, base, CONFIG_FILENAME)); // policy from BASE
    const basePkg = parsePackageJson(await fileAtRef(repo, base, 'package.json'));
    const headPkg = parsePackageJson(await fileAtRef(repo, head, 'package.json'));
    violations.push(...manifestBumpViolations(basePkg, headPkg, cfg.allowBumping ?? []));
  }

  return violations;
}

function parsePackageJson(raw: string | null): Record<string, unknown> {
  if (raw === null) throw new Error('package.json not found at ref'); // fail closed, as before
  return JSON.parse(raw);
}
