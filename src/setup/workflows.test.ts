import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { scaffoldProject } from '../test-helpers.ts';
import {
  detectLockfileHonestyCheck,
  discoverCiWorkflowNames,
  writeCallerWorkflows,
} from './workflows.ts';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const CI_YML = `name: CI
on:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
  lockfile-check:
    name: lockfile-honesty
    runs-on: ubuntu-latest
    steps:
      - uses: mixmaxhq/lockfile-assay@v1
`;

const OURS_YML = `name: waiver-stamp-ci
on:
  pull_request:
jobs:
  waiver-stamp:
    uses: jsalvata/waiver-stamp/.github/workflows/reusable-ci.yml@v1.23.0
`;

describe('discoverCiWorkflowNames', () => {
  it("returns the adopter's workflow names, skipping our own waiver-stamp-* callers", async () => {
    const { cwd, cleanup } = await scaffoldProject({
      '.github/workflows/ci.yml': CI_YML,
      '.github/workflows/waiver-stamp-ci.yml': OURS_YML,
    });
    try {
      expect(await discoverCiWorkflowNames(join(cwd, '.github/workflows'))).toEqual(['CI']);
    } finally {
      await cleanup();
    }
  });

  it('returns [] when the workflows directory is absent', async () => {
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      expect(await discoverCiWorkflowNames(join(cwd, '.github/workflows'))).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});

describe('detectLockfileHonestyCheck', () => {
  it('returns the check name of a job that uses lockfile-assay', async () => {
    const { cwd, cleanup } = await scaffoldProject({ '.github/workflows/ci.yml': CI_YML });
    try {
      expect(await detectLockfileHonestyCheck(join(cwd, '.github/workflows'))).toBe(
        'lockfile-honesty',
      );
    } finally {
      await cleanup();
    }
  });

  it('returns null when no job uses lockfile-assay', async () => {
    const { cwd, cleanup } = await scaffoldProject({
      '.github/workflows/ci.yml':
        'name: CI\non:\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n',
    });
    try {
      expect(await detectLockfileHonestyCheck(join(cwd, '.github/workflows'))).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

describe('writeCallerWorkflows', () => {
  const wf = (cwd: string, name: string) => join(cwd, '.github/workflows', name);

  it('writes both callers when neither exists, wiring the discovered CI names into the reviewer', async () => {
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      const result = await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      expect(result).toEqual({
        written: [
          '.github/workflows/waiver-stamp-ci.yml',
          '.github/workflows/waiver-stamp-review.yml',
        ],
        skipped: [],
      });

      const ci = parse(await readFile(wf(cwd, 'waiver-stamp-ci.yml'), 'utf8'));
      expect(ci.name).toBe('waiver-stamp-ci');
      expect(ci.jobs['waiver-stamp'].uses).toBe(
        `jsalvata/waiver-stamp/.github/workflows/reusable-ci.yml@v${version}`,
      );

      const review = parse(await readFile(wf(cwd, 'waiver-stamp-review.yml'), 'utf8'));
      // The one value the adopter must get right: the CI workflows the reviewer keys off, plus ours.
      expect(review.on.workflow_run.workflows).toEqual(['CI', 'waiver-stamp-ci']);
      expect(review.permissions['pull-requests']).toBe('write');
      expect(review.jobs.review.uses).toBe(
        `jsalvata/waiver-stamp/.github/workflows/reusable-review.yml@v${version}`,
      );
      expect(review.jobs.review.secrets.app_id).toBe('${{ secrets.WAIVER_STAMP_APP_ID }}');
    } finally {
      await cleanup();
    }
  });

  it('never overwrites an existing caller whose content DIFFERS — records it as skipped', async () => {
    const { cwd, cleanup } = await scaffoldProject({
      '.github/workflows/waiver-stamp-ci.yml': 'name: mine\n',
      '.github/workflows/waiver-stamp-review.yml': 'name: mine\n',
    });
    try {
      const result = await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      expect(result).toEqual({
        written: [],
        skipped: [
          '.github/workflows/waiver-stamp-ci.yml',
          '.github/workflows/waiver-stamp-review.yml',
        ],
      });
      // The pre-existing content is left byte-for-byte intact.
      expect(await readFile(wf(cwd, 'waiver-stamp-ci.yml'), 'utf8')).toBe('name: mine\n');
    } finally {
      await cleanup();
    }
  });

  it('is idempotent — a caller already holding our exact content is written, not skipped', async () => {
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      // A prior partial run (the reorder writes callers before provisioning) leaves our exact
      // files behind; a re-run must recognise them as ours, not warn about a "foreign" skip.
      const again = await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      expect(again).toEqual({
        written: [
          '.github/workflows/waiver-stamp-ci.yml',
          '.github/workflows/waiver-stamp-review.yml',
        ],
        skipped: [],
      });
    } finally {
      await cleanup();
    }
  });

  // A zizmor-style audit rewrites an adopted caller: tag pin → 40-hex hash pin with a `# vX.Y.Z`
  // marker, plus ignore/why comments (seen on lockfile-assay). Comments are inert in YAML and a
  // hash pin marked with this same version is the same ref — still our caller, not a foreign file.
  it('recognises a caller hardened with comments and a same-version hash pin as ours', async () => {
    const sha = 'a1b2c3d4'.repeat(5);
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      const harden = async (name: string, extra: (s: string) => string = (s) => s) => {
        const hardened = extra(
          (await readFile(wf(cwd, name), 'utf8')).replace(`@v${version}`, `@${sha} # v${version}`),
        );
        await writeFile(wf(cwd, name), hardened);
        return hardened;
      };
      const ci = await harden('waiver-stamp-ci.yml');
      const review = await harden('waiver-stamp-review.yml', (s) =>
        s.replace(
          'on:\n  workflow_run:',
          'on:\n  # The pwn-request defense lives in the pinned reusable workflow.\n  workflow_run: # zizmor: ignore[dangerous-triggers] see note above',
        ),
      );

      const again = await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      expect(again).toEqual({
        written: [
          '.github/workflows/waiver-stamp-ci.yml',
          '.github/workflows/waiver-stamp-review.yml',
        ],
        skipped: [],
      });
      // The hardening is preserved byte-for-byte — never rewritten back to the tag pin.
      expect(await readFile(wf(cwd, 'waiver-stamp-ci.yml'), 'utf8')).toBe(ci);
      expect(await readFile(wf(cwd, 'waiver-stamp-review.yml'), 'utf8')).toBe(review);
    } finally {
      await cleanup();
    }
  });

  it('keeps the skip for a hash pin marked with a different version — that drift is real', async () => {
    const sha = 'a1b2c3d4'.repeat(5);
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      const raw = await readFile(wf(cwd, 'waiver-stamp-ci.yml'), 'utf8');
      await writeFile(
        wf(cwd, 'waiver-stamp-ci.yml'),
        raw.replace(`@v${version}`, `@${sha} # v1.23.0`),
      );
      const again = await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      expect(again.skipped).toEqual(['.github/workflows/waiver-stamp-ci.yml']);
    } finally {
      await cleanup();
    }
  });

  it('keeps the skip when content differs beyond comments and the pin', async () => {
    const sha = 'a1b2c3d4'.repeat(5);
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      const raw = await readFile(wf(cwd, 'waiver-stamp-ci.yml'), 'utf8');
      await writeFile(
        wf(cwd, 'waiver-stamp-ci.yml'),
        raw
          .replace(`@v${version}`, `@${sha} # v${version}`)
          .replace('contents: read', 'contents: write'),
      );
      const again = await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      expect(again.skipped).toEqual(['.github/workflows/waiver-stamp-ci.yml']);
    } finally {
      await cleanup();
    }
  });

  // The generated callers and the hand-copy templates in examples/ are two paths to the same
  // caller. If they drift on the security-load-bearing fields (permissions, the pinned reusable
  // ref, the App-token secrets), adopters via the two paths get different posture — and pins.test
  // guards only examples/. This is that guard for the generated path.
  it('matches the reviewed examples/ templates on the security-load-bearing fields', async () => {
    const example = (name: string) =>
      readFile(fileURLToPath(new URL(`../../examples/${name}`, import.meta.url)), 'utf8').then(
        parse,
      );
    const { cwd, cleanup } = await scaffoldProject({});
    try {
      await writeCallerWorkflows(cwd, { ciWorkflowNames: ['CI'] });
      const genCi = parse(await readFile(wf(cwd, 'waiver-stamp-ci.yml'), 'utf8'));
      const genReview = parse(await readFile(wf(cwd, 'waiver-stamp-review.yml'), 'utf8'));
      const exCi = await example('waiver-stamp-ci.yml');
      const exReview = await example('waiver-stamp-review.yml');

      expect(genCi.jobs['waiver-stamp'].uses).toBe(exCi.jobs['waiver-stamp'].uses);
      expect(genReview.permissions).toEqual(exReview.permissions);
      expect(genReview.jobs.review.uses).toBe(exReview.jobs.review.uses);
      expect(genReview.jobs.review.secrets).toEqual(exReview.jobs.review.secrets);
    } finally {
      await cleanup();
    }
  });
});
