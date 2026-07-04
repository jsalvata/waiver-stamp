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

import type { DocPolicy } from './config.ts';

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/)/;
// The `change-docs` extension floor: inert text assets only. `.mdx` is
// deliberately excluded — MDX compiles to executable JS/JSX, so it can reach
// production behaviour and fails the "provably non-shipping" premise (§6.2).
const DOC_FILE = /\.(md|markdown|txt)$/i;

/**
 * Files that govern the test gate itself — never eligible for `change-test`
 * even though they are non-shipping (the backstop-integrity exclusion, §14.3).
 */
const BACKSTOP_INTEGRITY =
  /((^|\/)(vitest|vite|jest)\.config\.[cm]?[jt]s$|(^|\/)[^/]*setup[^/]*\.[cm]?[jt]sx?$|\.ya?ml$)/i;

export type ExclusionKind = 'change-test' | 'change-docs';

/**
 * Whether `file` satisfies the confinement predicate for an exclusion op (§6.2).
 * `change-docs` requires both the extension floor and the project's {@link DocPolicy}
 * (`allow` ∧ ¬`deny`); the policy can only narrow the floor, never widen it past
 * inert text assets. `change-test` ignores the doc policy.
 */
export function predicateOk(kind: ExclusionKind, file: string, docPolicy: DocPolicy): boolean {
  if (kind === 'change-docs') return DOC_FILE.test(file) && docPolicy.permits(file);
  if (BACKSTOP_INTEGRITY.test(file)) return false;
  return TEST_FILE.test(file);
}
