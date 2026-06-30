/**
 * waiver-stamp v0 type definitions.
 *
 * Mirrors the op vocabulary in docs/spec.md §5. The JSON Schema
 * (schema/waiver-stamp.v0.schema.json) is the runtime source of truth; these
 * types are the compile-time mirror consumers program against.
 */

export type SchemaVersion = 'waiver-stamp/v0';

/** A parsed, schema-valid waiver. */
export interface Waiver {
  /** Vocabulary/validation version. */
  schema: SchemaVersion;
  /** Pins op semantics + bundled ts-morph, e.g. `waiver-stamp@0.1.0`. */
  tool: string;
  /** Ordered list; transform ops apply in order, exclusion ops are order-free. */
  ops: Op[];
}

export type Op =
  | RenameOp
  | ExtractFunctionOp
  | MoveToNewFileOp
  | BumpOp
  | ChangeTestOp
  | ChangeDocsOp;

export type OpKind = Op['op'];

/** Which processing phase an op belongs to (§2). */
export type Phase = 'transform' | 'exclusion';

// ── Transform · reproductive (behaviour-preserving) ──────────────────────────

export interface RenameOp {
  op: 'rename';
  target: Selector;
  to: string;
}

export interface ExtractFunctionOp {
  op: 'extract-function';
  target: NodeLocator;
  name: string;
}

export interface MoveToNewFileOp {
  op: 'move-to-new-file';
  symbols: string[];
  from: string;
  to: string;
}

// ── Transform · transitive ───────────────────────────────────────────────────

export interface BumpOp {
  op: 'bump';
  packages: string[];
}

// ── Exclusion · confinement ──────────────────────────────────────────────────

export interface ChangeTestOp {
  op: 'change-test';
  files: string[];
}

export interface ChangeDocsOp {
  op: 'change-docs';
  files: string[];
}

// ── Selectors (§5.2) ─────────────────────────────────────────────────────────

/** A single declaration, addressed by file + TSDoc declaration reference. */
export interface Selector {
  file: string;
  symbol: string;
}

/** A node or a contiguous sibling span within one body. */
export interface NodeLocator {
  file: string;
  /** The enclosing function/method (a TSDoc symbol) to scope the search to. */
  within: string;
  from: NodeAnchor;
  /** Omit for a single node; present for an inclusive `from..to` sibling span. */
  to?: NodeAnchor;
}

/** A verbatim source snippet (normalized at resolution); `nth` disambiguates. */
export interface NodeAnchor {
  text: string;
  nth?: number;
}

/** Op kinds that mutate the tree and are folded over base, in order (§2). */
export const TRANSFORM_OP_KINDS = [
  'rename',
  'extract-function',
  'move-to-new-file',
  'bump',
] as const satisfies readonly OpKind[];

/** Op kinds that name files removed from the comparison; order-free (§2). */
export const EXCLUSION_OP_KINDS = [
  'change-test',
  'change-docs',
] as const satisfies readonly OpKind[];

/** Classify an op into its processing phase (§2). */
export function phaseOf(op: Op): Phase {
  return (EXCLUSION_OP_KINDS as readonly string[]).includes(op.op) ? 'exclusion' : 'transform';
}
