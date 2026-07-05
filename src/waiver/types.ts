/**
 * waiver-stamp type surface — inferred from the Zod schemas (schema.ts), the
 * single source of truth. No hand-mirrored shapes: change schema.ts and the
 * types, the JSON Schema, and runtime validation all follow.
 */

import type { z } from 'zod/v4';
import type {
  ChangeDocsOpSchema,
  ChangeTestOpSchema,
  ExtractFunctionOpSchema,
  LintFixOpSchema,
  MoveFileOpSchema,
  MoveToNewFileOpSchema,
  NodeAnchorSchema,
  NodeLocatorSchema,
  OpSchema,
  RenameOpSchema,
  SelectorSchema,
  WaiverSchema,
} from './schema.ts';

export type Waiver = z.infer<typeof WaiverSchema>;
export type Op = z.infer<typeof OpSchema>;
export type OpKind = Op['op'];

export type RenameOp = z.infer<typeof RenameOpSchema>;
export type ExtractFunctionOp = z.infer<typeof ExtractFunctionOpSchema>;
export type MoveToNewFileOp = z.infer<typeof MoveToNewFileOpSchema>;
export type MoveFileOp = z.infer<typeof MoveFileOpSchema>;
export type LintFixOp = z.infer<typeof LintFixOpSchema>;
export type ChangeTestOp = z.infer<typeof ChangeTestOpSchema>;
export type ChangeDocsOp = z.infer<typeof ChangeDocsOpSchema>;

export type Selector = z.infer<typeof SelectorSchema>;
export type NodeLocator = z.infer<typeof NodeLocatorSchema>;
export type NodeAnchor = z.infer<typeof NodeAnchorSchema>;

/** Which processing phase an op belongs to (§2). */
export type Phase = 'transform' | 'exclusion';

/** Op kinds that mutate the tree and are folded over base, in order (§2). */
export const TRANSFORM_OP_KINDS = [
  'rename',
  'extract-function',
  'move-to-new-file',
  'move-file',
  'lint-fix',
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
