/**
 * The standing dependency-bump policy (spec §6.3). Not a waiver op: when a waivered
 * commit changes `package.json`/lockfile, these gates decide whether the change is a
 * covered bump — allowlisted, plain-semver, up-moving, confined. Lockfile honesty is a
 * delegated precondition (§6.3 step 5): the repo's external always-on check (e.g.
 * lockfile-firewall) vouches the bytes, like CI vouches tsc/tests (§3.1.6) — this
 * module never re-resolves. Trusts upstream review of the bumped package; not
 * behaviour-preserving.
 */

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { z } from 'zod/v4';
import type { FileFinding } from '../report.ts';

/** Dependency blocks whose version-string values a bump may change. */
const DEP_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** `@scope/*` entries are scope prefixes; all others match a package name exactly (§6.3). */
export function matchesAllowlist(pkg: string, allowlist: readonly string[]): boolean {
  return allowlist.some((e) => (e.endsWith('/*') ? pkg.startsWith(e.slice(0, -1)) : pkg === e));
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * The bump envelope, fail-closed: base and head manifests must be identical except
 * version-string values in {@link DEP_BLOCKS}, for allowlisted packages, moving up
 * (head admits no version below base's floor) and staying plain semver.
 */
export function manifestBumpViolations(
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  allowlist: readonly string[],
): string[] {
  const violations: string[] = [];
  const blocks: readonly string[] = DEP_BLOCKS;
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (blocks.includes(key)) {
      violations.push(...blockViolations(key, asRecord(base[key]), asRecord(head[key]), allowlist));
    } else if (JSON.stringify(base[key]) !== JSON.stringify(head[key])) {
      violations.push(`field '${key}' changed`);
    }
  }
  return violations;
}

function blockViolations(
  block: string,
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  allowlist: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const pkg of new Set([...Object.keys(base), ...Object.keys(head)])) {
    const a = base[pkg];
    const b = head[pkg];
    if (a === undefined) {
      // Additions are the supply-chain surface — never covered.
      violations.push(`${block}: '${pkg}' added`);
    } else if (b !== undefined && a !== b) {
      // A version change: allowlisted, plain-semver, up-moving.
      if (!matchesAllowlist(pkg, allowlist)) {
        violations.push(`${block}: '${pkg}' is not on allowBumping`);
      } else if (typeof a !== 'string' || typeof b !== 'string') {
        violations.push(`${block}: '${pkg}' is not a version string`);
      } else {
        const move = versionMoveViolation(pkg, a, b);
        if (move) violations.push(`${block}: ${move}`);
      }
    }
    // A removal (a defined, b undefined) falls through → covered: it pulls in nothing,
    // so it needs no allowlist entry (§6.3).
  }
  return violations;
}

/**
 * `null` if `head` is a plain-semver *up-move* of `base` (head admits no version below
 * base's floor); otherwise a reason. Non-semver specifiers (`npm:`/`git:`/`catalog:`/…)
 * fail `validRange` → rejected. Fail-closed: an undecidable subset is a violation.
 */
function versionMoveViolation(pkg: string, base: string, head: string): string | null {
  const baseRange = semver.validRange(base);
  const headRange = semver.validRange(head);
  if (!baseRange) return `'${pkg}' base version '${base}' is not plain semver`;
  if (!headRange) return `'${pkg}' new version '${head}' is not plain semver`;
  const floor = semver.minVersion(baseRange);
  if (!floor) return `'${pkg}' base range '${base}' has no floor`;
  let up = false;
  try {
    up = semver.subset(headRange, `>=${floor.version}`, { includePrerelease: true });
  } catch {
    return `'${pkg}' move '${base}' → '${head}' is not decidable`;
  }
  if (!up)
    return `'${pkg}' new version '${head}' admits versions below base floor ${floor.version}`;
  return null;
}

/** Per-repo config at the repo root, read from BASE — a PR cannot widen it for itself. */
const CONFIG_FILE = '.waiver-stamp.json';
const LOCKFILE = 'pnpm-lock.yaml';
const MANIFEST = 'package.json';

const RepoConfigSchema = z.looseObject({
  allowBumping: z.array(z.string().min(1)).optional(),
});

/** What the standing policy needs from `validateCommit`. */
export interface DependencyContext {
  /** O's worktree (base = the commit's parent) — read for base's manifest + config. */
  oDir: string;
  /** The commit's worktree — read for head's manifest, never mutated. */
  headDir: string;
}

/**
 * If `package.json` is among the changed files, decide whether the manifest+lockfile
 * change is a covered bump (spec §6.3) and record findings. Returns the set of files
 * the policy claimed, so the caller's byte-compare skips them. Only the manifest
 * envelope is checked here — the lockfile bytes are vouched by the repo's external
 * lockfile-honesty check (§6.3 step 5), never re-derived by this tool.
 */
export async function coverDependencyBump(
  compareSet: readonly string[],
  ctx: DependencyContext,
  fileFindings: FileFinding[],
  failures: string[],
): Promise<Set<string>> {
  const claimed = new Set<string>();
  if (!compareSet.includes(MANIFEST)) return claimed;
  claimed.add(MANIFEST);
  if (compareSet.includes(LOCKFILE)) claimed.add(LOCKFILE);

  const reason = await evaluate(ctx);
  if (reason === null) {
    for (const f of claimed) fileFindings.push({ file: f, status: 'reproduced' });
  } else {
    for (const f of claimed) fileFindings.push({ file: f, status: 'mismatch', reason });
    failures.push(`dependency bump not covered: ${reason}`);
  }
  return claimed;
}

/** `null` if the manifest+lockfile change is a covered bump; else the reason it is not. */
async function evaluate(ctx: DependencyContext): Promise<string | null> {
  const baseManifest = await readManifest(ctx.oDir);
  if (!baseManifest) return `${MANIFEST} not found or invalid in base`;

  const pm = baseManifest.packageManager;
  if (typeof pm !== 'string' || !pm.startsWith('pnpm@')) {
    return 'base package.json must pin `packageManager` to pnpm (only pnpm is supported)';
  }
  try {
    await access(join(ctx.oDir, LOCKFILE));
  } catch {
    return `${LOCKFILE} not found in base`;
  }

  const allowlist = await loadAllowlist(ctx.oDir);
  if (allowlist === null) return `${CONFIG_FILE} is invalid`;
  if (allowlist.length === 0) return `no allowBumping configured in base ${CONFIG_FILE}`;

  const headManifest = await readManifest(ctx.headDir);
  if (!headManifest) return `${MANIFEST} not found or invalid in head`;

  const violations = manifestBumpViolations(baseManifest, headManifest, allowlist);
  if (violations.length > 0) return violations.join('; ');
  return null;
}

async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')));
  } catch {
    return null;
  }
}

/** `null` on malformed config; `[]` on absent/empty (feature off, fail-closed at the call site). */
async function loadAllowlist(baseDir: string): Promise<readonly string[] | null> {
  let raw: string;
  try {
    raw = await readFile(join(baseDir, CONFIG_FILE), 'utf8');
  } catch {
    return [];
  }
  try {
    return RepoConfigSchema.parse(JSON.parse(raw)).allowBumping ?? [];
  } catch {
    return null;
  }
}
