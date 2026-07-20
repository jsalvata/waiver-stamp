import { describe, expect, it, vi } from 'vitest';
import { setupRepository } from './setup-repository.ts';

const ctx = { owner: 'jsalvata', repo: 'demo', defaultBranch: 'main', pnpm: true };

describe('setupRepository (skeleton)', () => {
  it('runs preflight and reports the resolved context', async () => {
    const info = vi.fn();
    await setupRepository(
      { cwd: '/repo' },
      { preflight: vi.fn(async () => ctx), info, warn: vi.fn() },
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('jsalvata/demo'));
  });
  it('warns when pnpm-lock is absent', async () => {
    const warn = vi.fn();
    await setupRepository(
      { cwd: '/repo' },
      { preflight: vi.fn(async () => ({ ...ctx, pnpm: false })), info: vi.fn(), warn },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pnpm-lock'));
  });
});
