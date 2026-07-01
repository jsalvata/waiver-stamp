/**
 * The waiver op vocabulary, as Zod schemas — the single source of truth.
 *
 * TypeScript types are inferred from these (see types.ts) and the published JSON
 * Schema (schema/waiver-stamp.v0.schema.json) is generated from them via
 * {@link jsonSchema} (see scripts/gen-schema.ts). Nothing here is hand-mirrored.
 *
 * Uses the Zod v4 API via the 3.25 bridge (`zod/v4`) per the repo's Zod policy.
 */

import { z } from 'zod/v4';

export const SCHEMA_VERSION = 'waiver-stamp/v0';
export const SCHEMA_ID = 'https://waiver-stamp.dev/schema/waiver-stamp.v0.schema.json';

/**
 * Shared string type. Forbids triple backticks so an embedded waiver can never
 * contain a ` ``` ` fence — keeping the §17.1 commit-message fence unambiguous.
 */
const nonEmpty = z
  .string()
  .min(1)
  .regex(/^(?:(?!```)[\s\S])*$/, 'must not contain triple backticks');

// ── Selectors (§5.2) ─────────────────────────────────────────────────────────

export const SelectorSchema = z
  .object({
    file: nonEmpty,
    symbol: nonEmpty.describe('A TSDoc declaration reference, never line:col.'),
  })
  .strict()
  .describe('A single declaration, addressed by file + TSDoc declaration reference.');

export const NodeAnchorSchema = z
  .object({
    text: nonEmpty.describe('A verbatim source snippet; normalized at resolution.'),
    nth: z.int().min(1).optional().describe('Disambiguates in document order.'),
  })
  .strict();

export const NodeLocatorSchema = z
  .object({
    file: nonEmpty,
    within: nonEmpty.describe('The enclosing function/method (a TSDoc symbol).'),
    from: NodeAnchorSchema,
    to: NodeAnchorSchema.optional().describe(
      'Omit for a single node; present for a from..to span.',
    ),
  })
  .strict()
  .describe('A node or a contiguous sibling span within one body.');

// ── Transform · reproductive (behaviour-preserving) ──────────────────────────

export const RenameOpSchema = z
  .object({
    op: z.literal('rename'),
    target: SelectorSchema,
    to: nonEmpty,
  })
  .strict()
  .describe('Rename a symbol and all references within the loaded program.');

export const ExtractFunctionOpSchema = z
  .object({
    op: z.literal('extract-function'),
    target: NodeLocatorSchema,
    name: nonEmpty,
  })
  .strict()
  .describe('Extract a node/span into a named function.');

export const MoveToNewFileOpSchema = z
  .object({
    op: z.literal('move-to-new-file'),
    symbols: z.array(nonEmpty).min(1),
    from: nonEmpty,
    to: nonEmpty,
  })
  .strict()
  .describe('Move named top-level declarations to a new file, rewiring imports/exports.');

// ── Transform · transitive ───────────────────────────────────────────────────

export const BumpOpSchema = z
  .object({
    op: z.literal('bump'),
    packages: z.array(nonEmpty).min(1),
  })
  .strict()
  .describe('Bump allowlisted dependency versions (manifest + lockfile only).');

// ── Exclusion · confinement ──────────────────────────────────────────────────

export const ChangeTestOpSchema = z
  .object({
    op: z.literal('change-test'),
    files: z.array(nonEmpty).min(1),
  })
  .strict()
  .describe('Arbitrary edits to verified non-shipping test files.');

export const ChangeDocsOpSchema = z
  .object({
    op: z.literal('change-docs'),
    files: z.array(nonEmpty).min(1),
  })
  .strict()
  .describe('Arbitrary edits to verified non-shipping doc files.');

export const OpSchema = z.discriminatedUnion('op', [
  RenameOpSchema,
  ExtractFunctionOpSchema,
  MoveToNewFileOpSchema,
  BumpOpSchema,
  ChangeTestOpSchema,
  ChangeDocsOpSchema,
]);

export const WaiverSchema = z
  .object({
    schema: z.literal(SCHEMA_VERSION).describe('Vocabulary/validation version.'),
    ops: z
      .array(OpSchema)
      .describe('Ordered list; transform ops apply in order, exclusion ops are order-free.'),
  })
  .strict();

/**
 * The waiver as an MCP tool input (spec §18.1): the full {@link WaiverSchema}
 * object shape — so the tool is self-documenting and an LLM caller is guided to
 * pass structured JSON — but tolerant of a JSON *string* argument, which LLM
 * callers routinely send. A non-JSON string falls through to WaiverSchema and
 * fails with a normal validation error.
 */
export const InlineWaiverSchema = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}, WaiverSchema);

/**
 * The published JSON Schema, generated from {@link WaiverSchema}.
 *
 * Kept as a derived artifact so the op vocabulary has one source (Zod) while the
 * JSON Schema still serves its triple duty: LLM structured-output constraint,
 * author lint, and the stamper's closed-vocabulary gate (spec §4).
 */
export function jsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(WaiverSchema, { target: 'draft-7' });
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: SCHEMA_ID,
    title: SCHEMA_VERSION,
    ...generated,
  };
}

/** The exact on-disk serialization of {@link jsonSchema}; the drift-guard's reference. */
export function serializeJsonSchema(): string {
  return `${JSON.stringify(jsonSchema(), null, 2)}\n`;
}
