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

import picomatch from 'picomatch';
import { type WaiverConfig, loadConfig } from './config.ts';

/**
 * Whether the project policy permits confining a doc file via `change-docs`.
 *
 * A doc file is confinable only when it passes the op's intrinsic extension
 * floor AND this policy permits it: matched by `allow` and not matched by
 * `deny`. Both lists are empty by default, so a repo with no config (or an
 * empty `allow`) confines nothing — an AI-instruction asset like `.claude/**`
 * or `CLAUDE.md` cannot be waived away without an explicit, reviewable opt-in.
 */
export interface DocPolicy {
  /** True iff `file` is matched by `allow` and not matched by `deny`. */
  permits(file: string): boolean;
}

/** A matcher over repo-relative posix paths; empty patterns match nothing. */
function globMatcher(globs: string[]): (file: string) => boolean {
  if (globs.length === 0) return () => false;
  const isMatch = picomatch(globs, { dot: true });
  return (file) => isMatch(file);
}

/** Compile the `changeDocs` slice of a parsed config into a {@link DocPolicy}. */
export function docPolicyFrom(config: WaiverConfig): DocPolicy {
  const allowed = globMatcher(config.changeDocs.allow);
  const denied = globMatcher(config.changeDocs.deny);
  return { permits: (file) => allowed(file) && !denied(file) };
}

/**
 * Load `<dir>/.waiver-stamp.json` and compile its `change-docs` policy. Throws
 * {@link WaiverConfigError} on a malformed config — the caller fails closed.
 */
export async function loadDocPolicy(dir: string): Promise<DocPolicy> {
  return docPolicyFrom(await loadConfig(dir));
}

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
