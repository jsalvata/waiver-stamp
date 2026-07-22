import { declaredLinters } from '../engine/ops/lint-fix.ts';

export interface LintFixAdvisory {
  /** `resolved` = one linter declared; `none`/`ambiguous` = the lint-fix op fails closed (§6.1). */
  status: 'resolved' | 'none' | 'ambiguous';
  /** The supported linter packages the repo declares (for naming them in the warning). */
  declared: string[];
}

/**
 * Whether the repo's committed manifest resolves to exactly one supported linter (§6.1). The
 * `lint-fix` op fails closed on zero or more than one; this surfaces that at setup time instead of
 * at the first waiver. Warn-only — either state disables just that one op, so a repo mid-migration
 * (or one that never uses `lint-fix`) must not be blocked from adopting. Declaration is the source
 * of truth: no binary-presence check here (that's the op's apply-time concern).
 */
export async function detectLintFixLinter(cwd: string): Promise<LintFixAdvisory> {
  const declared = declaredLinters(cwd).map((l) => l.pkg);
  const status = declared.length === 1 ? 'resolved' : declared.length === 0 ? 'none' : 'ambiguous';
  return { status, declared };
}
