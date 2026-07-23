import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffoldProject } from '../test-helpers.ts';
import { seedConfigIfAbsent } from './config-seed.ts';

const readConfig = (cwd: string) =>
  readFile(join(cwd, '.waiver-stamp.json'), 'utf8').then(JSON.parse);

describe('seedConfigIfAbsent', () => {
  it('seeds a closed-by-default policy when no config exists', async () => {
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      expect(await seedConfigIfAbsent(cwd, {})).toEqual({ seeded: true, existing: false });
      const cfg = await readConfig(cwd);
      // Every gate closed — a scaffold the adopter widens deliberately, not a policy we pick.
      expect(cfg.allowBumping).toEqual([]);
      expect(cfg.changeDocs).toEqual({ allow: [], deny: [] });
      expect(cfg.lockfileHonestyCheck).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('records a detected lockfile-honesty check in the seed', async () => {
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      await seedConfigIfAbsent(cwd, { lockfileHonestyCheck: 'lockfile-honesty' });
      expect((await readConfig(cwd)).lockfileHonestyCheck).toBe('lockfile-honesty');
    } finally {
      await cleanup();
    }
  });

  it('never touches an existing policy — no widening (§4.11)', async () => {
    const original = '{ "allowBumping": ["lodash"] }\n';
    const { cwd, cleanup } = await scaffoldProject({ '.waiver-stamp.json': original });
    try {
      expect(await seedConfigIfAbsent(cwd, { lockfileHonestyCheck: 'lockfile-honesty' })).toEqual({
        seeded: false,
        existing: true,
      });
      expect(await readFile(join(cwd, '.waiver-stamp.json'), 'utf8')).toBe(original);
    } finally {
      await cleanup();
    }
  });
});
