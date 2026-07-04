/**
 * The standing dependency-bump policy (spec §6.3). Not a waiver op: when a waivered
 * commit changes `package.json`/lockfile, these gates decide whether the change is a
 * covered bump — allowlisted, plain-semver, up-moving, confined — and the lockfile
 * honestly re-resolves. Trusts upstream review of the bumped package; not
 * behaviour-preserving.
 */

import semver from 'semver';

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
      violations.push(`${block}: '${pkg}' added`);
    } else if (b === undefined) {
      violations.push(`${block}: '${pkg}' removed`);
    } else if (a !== b) {
      if (!matchesAllowlist(pkg, allowlist)) {
        violations.push(`${block}: '${pkg}' is not on allowBumping`);
      } else if (typeof a !== 'string' || typeof b !== 'string') {
        violations.push(`${block}: '${pkg}' is not a version string`);
      } else {
        const move = versionMoveViolation(pkg, a, b);
        if (move) violations.push(`${block}: ${move}`);
      }
    }
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
