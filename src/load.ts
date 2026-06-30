import { readFile } from 'node:fs/promises';
import { WaiverParseError, WaiverValidationError } from './errors.js';
import { WaiverSchema } from './schema.js';
import type { Waiver } from './types.js';

/**
 * Read a waiver file and validate it against the v0 schema (schema.ts).
 *
 * Throws {@link WaiverParseError} if the file is not valid JSON and
 * {@link WaiverValidationError} if it does not conform to the schema.
 */
export async function loadWaiver(path: string): Promise<Waiver> {
  const raw = await readFile(path, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new WaiverParseError(path, { cause });
  }

  return loadWaiverFromObject(parsed);
}

/**
 * Validate an already-parsed value against the v0 schema (schema.ts).
 *
 * The seam shared by file loading ({@link loadWaiver}) and the commit-embedded
 * path (§17.1), which parses the waiver out of a git commit message rather than
 * a file. Throws {@link WaiverValidationError} if it does not conform.
 */
export function loadWaiverFromObject(parsed: unknown): Waiver {
  const result = WaiverSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((i) => {
      const where = i.path.length ? `/${i.path.join('/')}` : '/';
      return `${where} ${i.message}`;
    });
    throw new WaiverValidationError(errors);
  }

  return result.data;
}
