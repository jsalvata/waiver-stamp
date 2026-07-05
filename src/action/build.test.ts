import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('reviewer bundle', () => {
  it('is up to date with source (run `pnpm build:action`)', () => {
    const path = '.github/actions/waiver-stamp-review/dist/index.js';
    const before = readFileSync(path, 'utf8');
    execFileSync('pnpm', ['build:action'], { stdio: 'ignore' });
    const after = readFileSync(path, 'utf8');
    expect(after).toBe(before);
  });
});
