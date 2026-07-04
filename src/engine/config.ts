/**
 * Project policy for the `change-docs` confinement op (spec §6.2), read from
 * `.waiver-stamp.json` at the repo root. A doc file is confinable only when it
 * passes the op's intrinsic extension floor AND this policy permits it:
 * matched by `allow` and not matched by `deny`. Both lists are empty by
 * default, so a repo with no config (or an empty `allow`) confines nothing —
 * an AI-instruction asset like `.claude/**` or `CLAUDE.md` cannot be waived
 * away without an explicit, reviewable opt-in.
 *
 * The policy is read from BASE (like `allowBumping`, §6.3): a PR cannot widen it
 * for itself. Belt-and-suspenders, a `.waiver-stamp.json` edit is also a
 * non-excludable, byte-compared diff, so loosening the policy forces review.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import picomatch from 'picomatch';
import { z } from 'zod/v4';
import { WaiverConfigError } from '../errors.ts';

export const CONFIG_FILENAME = '.waiver-stamp.json';

const GlobList = z.array(z.string());

// The outer object is loose: `.waiver-stamp.json` also carries sibling policies
// (`allowBumping` §6.3, `lockfileFirewall` §6.4) parsed elsewhere, so unknown
// top-level keys must pass through untouched. The `changeDocs` block itself is
// strict, to catch typos in `allow`/`deny`.
const ConfigSchema = z.looseObject({
  changeDocs: z
    .object({
      allow: GlobList.default([]),
      deny: GlobList.default([]),
    })
    .strict()
    .default({ allow: [], deny: [] }),
});

/** Whether the project policy permits confining a given doc file via `change-docs`. */
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

function makePolicy(allow: string[], deny: string[]): DocPolicy {
  const allowed = globMatcher(allow);
  const denied = globMatcher(deny);
  return { permits: (file) => allowed(file) && !denied(file) };
}

/**
 * Load the `change-docs` policy from `<dir>/.waiver-stamp.json`. A missing file
 * yields the empty policy (permits nothing). Malformed JSON or a schema
 * violation throws {@link WaiverConfigError} — fail closed.
 */
export async function loadDocPolicy(dir: string): Promise<DocPolicy> {
  const path = join(dir, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return makePolicy([], []);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new WaiverConfigError(path, 'not valid JSON', { cause });
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new WaiverConfigError(path, result.error.issues.map((i) => i.message).join('; '));
  }

  return makePolicy(result.data.changeDocs.allow, result.data.changeDocs.deny);
}
