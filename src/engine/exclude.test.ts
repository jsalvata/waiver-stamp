import { describe, expect, it } from 'vitest';
import type { WaiverConfig } from './config.ts';
import { type DocPolicy, docPolicyFrom, predicateOk } from './exclude.ts';

const permitAll: DocPolicy = { permits: () => true };
const permitNone: DocPolicy = { permits: () => false };
const permitOnly = (paths: string[]): DocPolicy => ({ permits: (f) => paths.includes(f) });

/** Build a config with the given `changeDocs` slice (other keys at their defaults). */
const configWith = (allow: string[], deny: string[] = []): WaiverConfig => ({
  changeDocs: { allow, deny },
  allowBumping: [],
});

describe('predicateOk — change-docs', () => {
  it('requires the extension floor: .md/.markdown/.txt pass, other extensions fail', () => {
    expect(predicateOk('change-docs', 'docs/a.md', permitAll)).toBe(true);
    expect(predicateOk('change-docs', 'docs/a.markdown', permitAll)).toBe(true);
    expect(predicateOk('change-docs', 'docs/a.txt', permitAll)).toBe(true);
    expect(predicateOk('change-docs', 'src/a.ts', permitAll)).toBe(false);
  });

  it('rejects .mdx — MDX compiles to executable JS/JSX, not an inert doc', () => {
    expect(predicateOk('change-docs', 'docs/a.mdx', permitAll)).toBe(false);
  });

  it('requires the policy to permit the file, even past the floor', () => {
    expect(predicateOk('change-docs', 'docs/a.md', permitNone)).toBe(false);
    expect(predicateOk('change-docs', 'docs/a.md', permitOnly(['docs/a.md']))).toBe(true);
    expect(predicateOk('change-docs', 'other/a.md', permitOnly(['docs/a.md']))).toBe(false);
  });
});

describe('predicateOk — change-test (unchanged by policy)', () => {
  it('confines a test file regardless of the doc policy', () => {
    expect(predicateOk('change-test', 'src/a.test.ts', permitNone)).toBe(true);
  });

  it('never confines a backstop-integrity file', () => {
    expect(predicateOk('change-test', 'vitest.config.ts', permitAll)).toBe(false);
  });

  it('rejects a non-test source file', () => {
    expect(predicateOk('change-test', 'src/a.ts', permitAll)).toBe(false);
  });
});

describe('docPolicyFrom — compiles the changeDocs slice', () => {
  it('permits nothing when allow is empty', () => {
    const policy = docPolicyFrom(configWith([]));
    expect(policy.permits('docs/guide.md')).toBe(false);
  });

  it('permits files matching an allow glob', () => {
    const policy = docPolicyFrom(configWith(['docs/**']));
    expect(policy.permits('docs/guide.md')).toBe(true);
    expect(policy.permits('docs/nested/deep.md')).toBe(true);
    expect(policy.permits('src/notes.md')).toBe(false);
  });

  it('denies a file even when it is also allowed (deny wins)', () => {
    const policy = docPolicyFrom(configWith(['**'], ['.claude/**', '**/CLAUDE.md']));
    expect(policy.permits('docs/guide.md')).toBe(true);
    expect(policy.permits('.claude/skills/x/SKILL.md')).toBe(false);
    expect(policy.permits('CLAUDE.md')).toBe(false);
    expect(policy.permits('packages/app/CLAUDE.md')).toBe(false);
  });
});
