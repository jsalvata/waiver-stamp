/**
 * Generate the published JSON Schema from the Zod source of truth (src/schema.ts).
 *
 * Run via `pnpm gen:schema` (and as a build step). The committed output is kept in
 * sync by a drift-guard test (src/schema.test.ts) that fails if it goes stale.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeJsonSchema } from '../src/schema.js';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'schema',
  'waiver-stamp.v0.schema.json',
);

await writeFile(OUT, serializeJsonSchema(), 'utf8');
console.log(`wrote ${OUT}`);
