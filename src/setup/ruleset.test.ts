import { describe, expect, it, vi } from 'vitest';
import type { GhClient, RulesetSpec, RulesetSummary } from './gh.ts';
import { ensureWaiverStampRuleset } from './ruleset.ts';

const args = { owner: 'jsalvata', repo: 'demo', defaultBranch: 'main' };

function ghWith(existing: RulesetSummary[]) {
  const createRuleset = vi.fn<GhClient['createRuleset']>(async () => {});
  const gh = {
    listRulesets: vi.fn<GhClient['listRulesets']>(async () => existing),
    createRuleset,
  } as unknown as GhClient;
  return { gh, createRuleset };
}

describe('ensureWaiverStampRuleset', () => {
  it('creates a dedicated waiver-stamp ruleset when none exists', async () => {
    const { gh, createRuleset } = ghWith([]);
    const result = await ensureWaiverStampRuleset(gh, args);
    expect(result).toBe('created');
    expect(createRuleset).toHaveBeenCalledOnce();
    const spec = createRuleset.mock.calls[0]?.[2] as RulesetSpec;
    // Requires only the waiver-stamp check on the default branch — nothing else (§4.6).
    expect(spec.name).toBe('waiver-stamp');
    expect(spec.enforcement).toBe('active');
    expect(spec.conditions.ref_name.include).toEqual(['refs/heads/main']);
    expect(spec.rules[0]?.parameters.required_status_checks).toEqual([{ context: 'waiver-stamp' }]);
  });

  it('no-ops when a waiver-stamp ruleset is already present', async () => {
    const { gh, createRuleset } = ghWith([{ name: 'protect-main' }, { name: 'waiver-stamp' }]);
    const result = await ensureWaiverStampRuleset(gh, args);
    expect(result).toBe('exists');
    expect(createRuleset).not.toHaveBeenCalled();
  });
});
