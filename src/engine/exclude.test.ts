import { describe, expect, it } from 'vitest';
import type { DocPolicy } from './config.ts';
import { predicateOk } from './exclude.ts';

const permitAll: DocPolicy = { permits: () => true };
const permitNone: DocPolicy = { permits: () => false };
const permitOnly = (paths: string[]): DocPolicy => ({ permits: (f) => paths.includes(f) });

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
