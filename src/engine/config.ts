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
 *
 * {@link ConfigSchema} is the single source of truth: the published JSON Schema
 * (schema/waiver-stamp-config.v0.schema.json) is generated from it via
 * {@link configJsonSchema} (see scripts/gen-schema.ts) and drift-guarded by a
 * test, the same way the waiver schema is — so editors can validate the file.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { WaiverConfigError } from '../errors.ts';

export const CONFIG_FILENAME = '.waiver-stamp.json';

export const CONFIG_SCHEMA_ID =
  'https://raw.githubusercontent.com/jsalvata/waiver-stamp/main/schema/waiver-stamp-config.v0.schema.json';

const GlobList = z.array(z.string());

// One schema for the whole file. The outer object is STRICT: an unrecognised
// top-level key is a hard error, never silently ignored — a config written for a
// newer waiver-stamp must not slip through unenforced under an older one.
// `changeDocs` is likewise strict, to catch typos in `allow`/`deny`.
export const ConfigSchema = z
  .object({
    // The conventional inline pointer to the published JSON Schema, so an editor
    // validates `.waiver-stamp.json` as the author types. Recognised and ignored
    // here — the strict outer object would otherwise fail closed on it (§6.5).
    $schema: z.string().optional().describe('Optional pointer to the published JSON Schema.'),
    changeDocs: z
      .object({
        allow: GlobList.default([]).describe('Glob allow-list for the change-docs op (§6.5).'),
        deny: GlobList.default([]).describe('Glob deny-list; a hard veto over allow (§6.5).'),
      })
      .strict()
      .default({ allow: [], deny: [] })
      .describe('The change-docs confinement policy (§6.5).'),
    allowBumping: z
      .array(z.string().min(1))
      .default([])
      .describe('The dependency-bump allow-list: scope prefixes or exact names (§6.3).'),
    lockfileHonestyCheck: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Name of the required check that proves the lockfile is honest (e.g. the lockfile-assay job/check name). When it is a required check, the "assumes the lockfile is honest" caveat is dropped from APPROVE reviews (spec §2.5).',
      ),
  })
  .strict()
  .describe('Project config at .waiver-stamp.json (repo root); each key is a standing policy.');

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

/**
 * The published JSON Schema for `.waiver-stamp.json`, generated from
 * {@link ConfigSchema}. A derived artifact — the Zod schema is the single source
 * of truth — kept in sync by a drift-guard test the same way the waiver schema is.
 *
 * Emitted in `input` mode: every key carries a default, so an author may omit any
 * of them (an empty `{}` is a valid config), exactly as {@link loadConfig} treats
 * a missing or partial file. In `output` mode the defaulted keys would read as
 * required, wrongly rejecting the sparse configs the loader accepts.
 */
export function configJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(ConfigSchema, { target: 'draft-7', io: 'input' });
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: CONFIG_SCHEMA_ID,
    title: 'waiver-stamp config',
    ...generated,
  };
}

/** The exact on-disk serialization of {@link configJsonSchema}; the drift-guard's reference. */
export function serializeConfigJsonSchema(): string {
  return `${JSON.stringify(configJsonSchema(), null, 2)}\n`;
}
