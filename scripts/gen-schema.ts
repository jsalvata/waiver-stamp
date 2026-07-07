/**
 * Generate the published JSON Schemas from their Zod sources of truth:
 *   - the waiver vocabulary (src/waiver/schema.ts)
 *   - the project config `.waiver-stamp.json` (src/engine/config.ts)
 *
 * Run via `pnpm gen:schema` (and as a build step). The committed outputs are kept
 * in sync by drift-guard tests (src/waiver/schema.test.ts, src/engine/config.test.ts)
 * that fail if either goes stale.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeConfigJsonSchema } from '../src/engine/config.ts';
import { serializeJsonSchema } from '../src/waiver/schema.ts';

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');

const outputs = [
  { file: 'waiver-stamp.v0.schema.json', serialize: serializeJsonSchema },
  { file: 'waiver-stamp-config.v0.schema.json', serialize: serializeConfigJsonSchema },
];

for (const { file, serialize } of outputs) {
  const out = join(schemaDir, file);
  await writeFile(out, serialize(), 'utf8');
  console.log(`wrote ${out}`);
}
