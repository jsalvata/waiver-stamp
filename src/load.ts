import { readFile } from 'node:fs/promises';
import { WaiverParseError, WaiverValidationError } from './errors.ts';
import { WaiverSchema } from './schema.ts';
import type { Waiver } from './types.ts';

/** Read all of stdin as UTF-8 (the `-` waiver source). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Read a waiver from a file (or from stdin when `path` is `-`) and validate it
 * against the v0 schema (schema.ts).
 *
 * Throws {@link WaiverParseError} if the source is not valid JSON and
 * {@link WaiverValidationError} if it does not conform to the schema. Callers
 * must read the waiver at most once per invocation — stdin is consumable.
 */
export async function loadWaiver(path: string): Promise<Waiver> {
  const source = path === '-' ? '<stdin>' : path;
  const raw = path === '-' ? await readStdin() : await readFile(path, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new WaiverParseError(source, { cause });
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
