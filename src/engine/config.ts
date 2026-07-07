/**
 * The project config at `.waiver-stamp.json` (repo root). One file, one schema,
 * loaded by {@link loadConfig}; each standing policy pulls the slice it owns:
 *
 *   - `changeDocs` — the allow/deny globs for the `change-docs` confinement op
 *     (spec §6.2), compiled into a `DocPolicy` by `exclude.ts`.
 *   - `allowBumping` — the dependency-bump allowlist (§6.3), read by `deps.ts`.
 *
 * The config is read from BASE (§6.3): a PR cannot widen it for itself.
 * Belt-and-suspenders, a `.waiver-stamp.json` edit is also a non-excludable,
 * byte-compared diff, so loosening any policy forces review of that very commit.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { WaiverConfigError } from '../errors.ts';

export const CONFIG_FILENAME = '.waiver-stamp.json';

const GlobList = z.array(z.string());

// One schema for the whole file. The outer object is STRICT: an unrecognised
// top-level key is a hard error, never silently ignored — a config written for a
// newer waiver-stamp must not slip through unenforced under an older one.
// `changeDocs` is likewise strict, to catch typos in `allow`/`deny`.
const ConfigSchema = z
  .object({
    changeDocs: z
      .object({
        allow: GlobList.default([]),
        deny: GlobList.default([]),
      })
      .strict()
      .default({ allow: [], deny: [] }),
    allowBumping: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** The parsed project config; each policy reads the slice it owns. */
export type WaiverConfig = z.infer<typeof ConfigSchema>;

/** Parse raw `.waiver-stamp.json` contents (or null for a missing file). */
export function parseConfig(
  raw: string | null,
  pathForErrors: string = CONFIG_FILENAME,
): WaiverConfig {
  if (raw === null) return ConfigSchema.parse({});
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new WaiverConfigError(pathForErrors, 'not valid JSON', { cause });
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new WaiverConfigError(
      pathForErrors,
      result.error.issues.map((i) => i.message).join('; '),
    );
  }
  return result.data;
}

/**
 * Parse `<dir>/.waiver-stamp.json` against the single project schema. A missing
 * file yields the empty config (every policy off). Malformed JSON, an unknown
 * key, or a schema violation throws {@link WaiverConfigError} — fail closed.
 */
export async function loadConfig(dir: string): Promise<WaiverConfig> {
  const path = join(dir, CONFIG_FILENAME);
  let raw: string | null;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    raw = null;
  }
  return parseConfig(raw, path);
}
