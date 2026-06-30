import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import _Ajv, { type ValidateFunction } from 'ajv';
import _addFormats from 'ajv-formats';
import { WaiverParseError, WaiverValidationError } from './errors.js';

// ajv and ajv-formats are CJS (`export =`); under NodeNext ESM the default import
// is the value at runtime but its type is the (non-constructable) namespace. Cast
// to the real constructor/function type. See ajv's ESM usage notes.
const Ajv = _Ajv as unknown as typeof _Ajv.default;
const addFormats = _addFormats as unknown as typeof _addFormats.default;
import type { Waiver } from './types.js';

/**
 * The schema ships as a runtime asset (package `files` includes `schema/`), so we
 * read it from disk rather than importing it — keeping it outside `rootDir` and a
 * single source of truth for both the runtime validator and external consumers.
 */
const SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'schema',
  'waiver-stamp.v0.schema.json',
);

let validator: ValidateFunction | undefined;

async function getValidator(): Promise<ValidateFunction> {
  if (validator) return validator;
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const compiled = ajv.compile(schema);
  validator = compiled;
  return compiled;
}

/**
 * Read a waiver file and validate it against the v0 JSON Schema.
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

  const validate = await getValidator();
  if (!validate(parsed)) {
    const errors = (validate.errors ?? []).map((e) =>
      `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`.trim(),
    );
    throw new WaiverValidationError(errors);
  }

  return parsed as Waiver;
}
