/**
 * Confinement predicates for exclusion ops (spec §6.2). A file an exclusion op
 * names must pass its predicate to be removed from the compare; a failure makes
 * the whole stamp FAIL (a hand-edited production file then mismatches `O`).
 *
 * v0 uses path-pattern predicates. The spec's authoritative test is production
 * tsconfig *program membership* (§14.3) — a stronger, self-maintaining check that
 * also catches "test file imported by production". That hardening needs a
 * production/test tsconfig split and is a documented v0 limitation (spec §1.1
 * lists confinement predicates as heuristic + fail-closed). Patterns here stay
 * deliberately conservative.
 */

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/)/;
const DOC_FILE = /\.(md|mdx|markdown|txt)$/i;

/**
 * Files that govern the test gate itself — never eligible for `change-test`
 * even though they are non-shipping (the backstop-integrity exclusion, §14.3).
 */
const BACKSTOP_INTEGRITY =
  /((^|\/)(vitest|vite|jest)\.config\.[cm]?[jt]s$|(^|\/)[^/]*setup[^/]*\.[cm]?[jt]sx?$|\.ya?ml$)/i;

export type ExclusionKind = 'change-test' | 'change-docs';

/** Whether `file` satisfies the confinement predicate for an exclusion op (§6.2). */
export function predicateOk(kind: ExclusionKind, file: string): boolean {
  if (kind === 'change-docs') return DOC_FILE.test(file);
  if (BACKSTOP_INTEGRITY.test(file)) return false;
  return TEST_FILE.test(file);
}
