/**
 * The project config at `.waiver-stamp.json` (repo root). One file, one schema,
 * parsed once by {@link loadConfig}; each standing policy consumes its own slice:
 *
 *   - `changeDocs` — the allow/deny globs for the `change-docs` confinement op
 *     (spec §6.2), compiled by {@link docPolicyFrom} into a {@link DocPolicy}.
 *   - `allowBumping` — the dependency-bump allowlist (§6.3), read by `deps.ts`.
 *
 * The config is read from BASE (§6.3): a PR cannot widen it for itself.
 * Belt-and-suspenders, a `.waiver-stamp.json` edit is also a non-excludable,
 * byte-compared diff, so loosening any policy forces review of that very commit.
 *
 * A doc file is confinable via `change-docs` only when it passes the op's
 * intrinsic extension floor AND the policy permits it: matched by `allow` and
 * not matched by `deny`. Both lists are empty by default, so a repo with no
 * config (or an empty `allow`) confines nothing — an AI-instruction asset like
 * `.claude/**` or `CLAUDE.md` cannot be waived away without an explicit,
 * reviewable opt-in.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import picomatch from 'picomatch';
import { z } from 'zod/v4';
import { WaiverConfigError } from '../errors.ts';

export const CONFIG_FILENAME = '.waiver-stamp.json';

const GlobList = z.array(z.string());

// The outer object is loose so a future sibling policy can land without a
// breaking parse. Each known key is validated, though: `changeDocs` is strict
// (to catch typos in `allow`/`deny`), and `allowBumping` is recognised so the
// whole file is checked once against a single schema.
const ConfigSchema = z.looseObject({
  changeDocs: z
    .object({
      allow: GlobList.default([]),
      deny: GlobList.default([]),
    })
    .strict()
    .default({ allow: [], deny: [] }),
  allowBumping: z.array(z.string().min(1)).default([]),
});

/** The parsed project config; each policy reads the slice it owns. */
export type WaiverConfig = z.infer<typeof ConfigSchema>;

/** The empty config (every policy off) — the fail-closed fallback for a malformed file. */
export const EMPTY_CONFIG: WaiverConfig = ConfigSchema.parse({});

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

/** Compile the `change-docs` allow/deny slice into a {@link DocPolicy}. */
export function docPolicyFrom(config: WaiverConfig): DocPolicy {
  const allowed = globMatcher(config.changeDocs.allow);
  const denied = globMatcher(config.changeDocs.deny);
  return { permits: (file) => allowed(file) && !denied(file) };
}

/**
 * Parse `<dir>/.waiver-stamp.json` once. A missing file yields the empty config
 * (every policy off). Malformed JSON or a schema violation throws
 * {@link WaiverConfigError} — fail closed.
 */
export async function loadConfig(dir: string): Promise<WaiverConfig> {
  const path = join(dir, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return ConfigSchema.parse({});
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

  return result.data;
}
