import { describe, expect, it, vi } from 'vitest';
import type { GhClient } from '../setup/gh.ts';
import { SECRET_NAMES } from '../setup/secrets.ts';
import { type SetupDeps, setupRepository } from './setup-repository.ts';

const ctx = { owner: 'jsalvata', repo: 'demo', defaultBranch: 'main' };

const fakeGh = (): GhClient => ({
  listOrgs: vi.fn(async () => []),
  setSecret: vi.fn(async () => {}),
  appConversion: vi.fn(async () => ({ appId: 1, pem: 'p', slug: 's' })),
  tokenScopes: vi.fn(async () => ['repo', 'admin:org']),
  viewerLogin: vi.fn(async () => 'jsalvata'),
  accountType: vi.fn(async () => 'User' as const),
  orgSecrets: vi.fn(async () => []),
  repoSecretNames: vi.fn(async () => []),
  grantOrgSecretRepo: vi.fn(async () => {}),
  orgAppSlugs: vi.fn(async () => []),
  listRulesets: vi.fn(async () => []),
  createRuleset: vi.fn(async () => {}),
  fileExistsOnRef: vi.fn(async () => false),
  requiredCheckContexts: vi.fn(async () => null),
});

function makeDeps(over: Partial<SetupDeps> = {}): SetupDeps {
  return {
    preflight: vi.fn(async () => ctx),
    gh: fakeGh(),
    resolveTarget: vi.fn(async () => ({ kind: 'personal' as const })),
    // Fresh path: the real resolveApp runs the loopback flow, whose callback renders the hand-off
    // in its tab. Emulate that here so handoffPage is exercised on the fresh path (where nothing
    // opens a second tab), keyed on the new slug.
    resolveApp: vi.fn(async (d) => {
      d.renderDonePage('waiver-stamp-jsalvata');
      return {
        source: 'fresh' as const,
        appId: 42,
        pem: '-----BEGIN…',
        slug: 'waiver-stamp-jsalvata',
      };
    }),
    provisionSecrets: vi.fn(async () => {}),
    grantExistingOrgSecrets: vi.fn(async () => {}),
    confirmYesNo: vi.fn(async () => false),
    openBrowser: vi.fn(async () => {}),
    discoverCiWorkflowNames: vi.fn(async () => ['CI']),
    detectLockfileHonestyCheck: vi.fn(async () => null),
    writeCallerWorkflows: vi.fn(async () => ({
      written: [
        '.github/workflows/waiver-stamp-ci.yml',
        '.github/workflows/waiver-stamp-review.yml',
      ],
      skipped: [],
    })),
    seedConfigIfAbsent: vi.fn(async () => ({ seeded: true, existing: false })),
    detectCommitlintBodyLimit: vi.fn(async () => ({ blocks: false })),
    detectLintFixLinter: vi.fn(async () => ({
      status: 'resolved' as const,
      declared: ['@biomejs/biome'],
    })),
    ensureWaiverStampRuleset: vi.fn(async () => 'created' as const),
    handoffPage: vi.fn(() => '<handoff>'),
    openHandoff: vi.fn(async () => {}),
    info: vi.fn(),
    ...over,
  };
}

describe('setupRepository', () => {
  it('runs preflight and reports the resolved context', async () => {
    const info = vi.fn();
    await setupRepository({ cwd: '/repo' }, makeDeps({ info }));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('jsalvata/demo'));
  });

  it('provisions the App and secrets on the fresh path without opening a second install tab', async () => {
    const provisionSecrets = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    await setupRepository({ cwd: '/repo' }, makeDeps({ provisionSecrets, openBrowser }));
    expect(provisionSecrets).toHaveBeenCalledOnce();
    // The orchestrator opens no browser tab of its own on any path — the loopback callback serves
    // its confirmation page, and the remaining steps ride the hand-off page (via openHandoff).
    expect(openBrowser).not.toHaveBeenCalled();
  });

  describe('config + workflow phase (always runs)', () => {
    it('writes the caller workflows and seeds the config', async () => {
      const d = makeDeps();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.writeCallerWorkflows).toHaveBeenCalledWith('/repo', { ciWorkflowNames: ['CI'] });
      expect(d.seedConfigIfAbsent).toHaveBeenCalledOnce();
    });

    it('feeds a detected lockfile-honesty check into the seed', async () => {
      const seedConfigIfAbsent = vi.fn(async () => ({ seeded: true, existing: false }));
      const d = makeDeps({
        detectLockfileHonestyCheck: vi.fn(async () => 'lockfile-honesty'),
        seedConfigIfAbsent,
      });
      await setupRepository({ cwd: '/repo' }, d);
      expect(seedConfigIfAbsent).toHaveBeenCalledWith('/repo', {
        lockfileHonestyCheck: 'lockfile-honesty',
      });
    });

    // §4.11: the seeded name must be one the reviewer's autodiscovery can confirm required — a
    // required context naming lockfile-assay (e.g. an App-posted check) beats the YAML job name.
    it('seeds a required lockfile-assay context over a detected job that is not required', async () => {
      const seedConfigIfAbsent = vi.fn(async () => ({ seeded: true, existing: false }));
      const gh: GhClient = {
        ...fakeGh(),
        requiredCheckContexts: vi.fn(async () => ['test', 'lockfile-assay']),
      };
      const d = makeDeps({
        gh,
        detectLockfileHonestyCheck: vi.fn(async () => 'assay'),
        seedConfigIfAbsent,
      });
      await setupRepository({ cwd: '/repo' }, d);
      expect(gh.requiredCheckContexts).toHaveBeenCalledWith('jsalvata', 'demo', 'main');
      expect(seedConfigIfAbsent).toHaveBeenCalledWith('/repo', {
        lockfileHonestyCheck: 'lockfile-assay',
      });
    });

    // Advisories are page-only (§6): they go into the hand-off's caveats, not the terminal.
    type Caveat = { text: string; doc?: { href: string; label: string } };
    const rawCaveatsOf = (handoffPage: ReturnType<typeof vi.fn>): Caveat[] =>
      (handoffPage.mock.calls[0]?.[0] as { caveats: Caveat[] }).caveats;
    const caveatsOf = (handoffPage: ReturnType<typeof vi.fn>): string[] =>
      rawCaveatsOf(handoffPage).map((c) => c.text);

    it('carries each untouched caller into the hand-off caveats', async () => {
      const handoffPage = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          handoffPage,
          writeCallerWorkflows: vi.fn(async () => ({
            written: [],
            skipped: ['.github/workflows/waiver-stamp-ci.yml'],
          })),
        }),
      );
      expect(caveatsOf(handoffPage)).toContainEqual(expect.stringContaining('waiver-stamp-ci.yml'));
    });

    it('caveats a seeded honesty check that is not a required check', async () => {
      const handoffPage = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          handoffPage,
          gh: { ...fakeGh(), requiredCheckContexts: vi.fn(async () => ['test']) },
          detectLockfileHonestyCheck: vi.fn(async () => 'assay'),
        }),
      );
      expect(caveatsOf(handoffPage)).toContainEqual(
        expect.stringMatching(/"assay" is not required on main/),
      );
    });

    it('raises no honesty caveat when the resolved check is required', async () => {
      const handoffPage = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          handoffPage,
          gh: { ...fakeGh(), requiredCheckContexts: vi.fn(async () => ['lockfile-assay']) },
          detectLockfileHonestyCheck: vi.fn(async () => 'assay'),
        }),
      );
      expect(caveatsOf(handoffPage)).not.toContainEqual(expect.stringMatching(/honest/));
    });

    it('carries the commitlint caveat into the hand-off when long bodies would be rejected', async () => {
      const handoffPage = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({ handoffPage, detectCommitlintBodyLimit: vi.fn(async () => ({ blocks: true })) }),
      );
      expect(caveatsOf(handoffPage)).toContainEqual(expect.stringMatching(/body-max-line-length/));
    });

    it('carries the lint-fix caveat into the hand-off for none/ambiguous linters', async () => {
      const none = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          handoffPage: none,
          detectLintFixLinter: vi.fn(async () => ({ status: 'none' as const, declared: [] })),
        }),
      );
      expect(caveatsOf(none)).toContainEqual(expect.stringMatching(/lint-fix/));
      // The lint-fix caveat deep-links the spec §6.1 anchor, version-pinned (blob/vX.Y.Z).
      expect(rawCaveatsOf(none)[0]?.doc?.href).toMatch(
        /\/blob\/v\d+\.\d+\.\d+\/docs\/spec\.md#61-transform-ops/,
      );

      const many = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          handoffPage: many,
          detectLintFixLinter: vi.fn(async () => ({
            status: 'ambiguous' as const,
            declared: ['@biomejs/biome', 'eslint'],
          })),
        }),
      );
      expect(caveatsOf(many)).toContainEqual(expect.stringMatching(/@biomejs\/biome, eslint/));
    });
  });

  describe('§4.13 phase boundary — the ruleset must not precede the producer', () => {
    it('creates no ruleset and points at the merge/re-run step when the producer is not on the default branch', async () => {
      const info = vi.fn();
      const d = makeDeps({ info }); // fileExistsOnRef defaults to false
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.ensureWaiverStampRuleset).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/re-run/i));
    });

    it('gates on the producer caller on the default branch, not a default-branch check run', async () => {
      const fileExistsOnRef = vi.fn(async () => true);
      const gh: GhClient = { ...fakeGh(), fileExistsOnRef };
      const d = makeDeps({ gh });
      await setupRepository({ cwd: '/repo' }, d);
      // The `waiver-stamp` check never reports on default-branch commits, so the gate reads the
      // producer caller's presence there instead.
      expect(fileExistsOnRef).toHaveBeenCalledWith(
        'jsalvata',
        'demo',
        '.github/workflows/waiver-stamp-ci.yml',
        'main',
      );
      expect(d.ensureWaiverStampRuleset).toHaveBeenCalledWith(gh, ctx);
      // §4.13 ordering: callers are written before the required-check ruleset exists.
      const wrote = (d.writeCallerWorkflows as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0];
      const ruled = (d.ensureWaiverStampRuleset as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0];
      expect(wrote).toBeLessThan(ruled ?? Number.POSITIVE_INFINITY);
    });

    it('re-run with an existing ruleset converges to a no-op message', async () => {
      const info = vi.fn();
      const gh: GhClient = { ...fakeGh(), fileExistsOnRef: vi.fn(async () => true) };
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({ info, gh, ensureWaiverStampRuleset: vi.fn(async () => 'exists' as const) }),
      );
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/ruleset exists/i));
    });
  });

  describe('hand-off page', () => {
    it('renders the hand-off with the provisioned slug and config state, served in the callback tab', async () => {
      const handoffPage = vi.fn(() => '<handoff>');
      const openHandoff = vi.fn(async () => {});
      await setupRepository({ cwd: '/repo' }, makeDeps({ handoffPage, openHandoff }));
      expect(handoffPage).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'jsalvata',
          repo: 'demo',
          slug: 'waiver-stamp-jsalvata',
          configExisted: false,
        }),
      );
      // Fresh path: the loopback callback served it (via renderDonePage), so the orchestrator opens
      // no second tab of its own.
      expect(openHandoff).not.toHaveBeenCalled();
    });

    it('tells the hand-off whether the producer is already on the default branch', async () => {
      const notYet = vi.fn(() => '<handoff>');
      await setupRepository({ cwd: '/repo' }, makeDeps({ handoffPage: notYet })); // fileExistsOnRef=false
      expect(notYet).toHaveBeenCalledWith(expect.objectContaining({ producerOnDefault: false }));

      const live = vi.fn(() => '<handoff>');
      const gh: GhClient = { ...fakeGh(), fileExistsOnRef: vi.fn(async () => true) };
      await setupRepository({ cwd: '/repo' }, makeDeps({ handoffPage: live, gh }));
      expect(live).toHaveBeenCalledWith(expect.objectContaining({ producerOnDefault: true }));
    });

    it('suggests the honesty edit only for an existing config that was missing it', async () => {
      const handoffPage = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          handoffPage,
          detectLockfileHonestyCheck: vi.fn(async () => 'lockfile-honesty'),
          seedConfigIfAbsent: vi.fn(async () => ({ seeded: false, existing: true })),
        }),
      );
      expect(handoffPage).toHaveBeenCalledWith(
        expect.objectContaining({ configExisted: true, suggestedHonestyCheck: 'lockfile-honesty' }),
      );
    });

    it('suggests the resolved (required) name, not the raw detection', async () => {
      const handoffPage = vi.fn(() => '<handoff>');
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          handoffPage,
          gh: { ...fakeGh(), requiredCheckContexts: vi.fn(async () => ['lockfile-assay']) },
          detectLockfileHonestyCheck: vi.fn(async () => 'assay'),
          seedConfigIfAbsent: vi.fn(async () => ({ seeded: false, existing: true })),
        }),
      );
      expect(handoffPage).toHaveBeenCalledWith(
        expect.objectContaining({ suggestedHonestyCheck: 'lockfile-assay' }),
      );
    });
  });

  it('an org-owned repo without the admin:org scope fails before creating the App', async () => {
    const gh: GhClient = { ...fakeGh(), tokenScopes: vi.fn(async () => ['repo', 'read:org']) };
    const d = makeDeps({
      resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
      gh,
    });
    const err = await setupRepository({ cwd: '/repo' }, d).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'SetupError', message: expect.stringMatching(/admin:org/) });
    // The scope check still aborts before the App is created (no orphan)…
    expect(d.resolveApp).not.toHaveBeenCalled();
    // …but the repo half now runs first, so the callers are already written (non-destructive and
    // idempotent — a re-run after `gh auth refresh` skips them). The hand-off never opens, though.
    expect(d.writeCallerWorkflows).toHaveBeenCalledOnce();
    expect(d.openHandoff).not.toHaveBeenCalled();
  });

  it('--no-app skips App provisioning but still configures the repo half', async () => {
    const d = makeDeps();
    await setupRepository({ cwd: '/repo', noApp: true }, d);
    expect(d.resolveApp).not.toHaveBeenCalled();
    expect(d.provisionSecrets).not.toHaveBeenCalled();
    // The file/config half is independent of the App and still runs.
    expect(d.writeCallerWorkflows).toHaveBeenCalledOnce();
    expect(d.seedConfigIfAbsent).toHaveBeenCalledOnce();
    expect(d.openHandoff).toHaveBeenCalledOnce();
  });

  // Re-running on a configured repo must not mint a second App (design §1), but the resume still
  // has to reach the ruleset/hand-off phases — the personal-path secrets were written run 1.
  describe('already provisioned (resume)', () => {
    const configured = (over: Partial<SetupDeps> = {}) =>
      makeDeps({
        gh: { ...fakeGh(), repoSecretNames: vi.fn(async () => [...SECRET_NAMES, 'UNRELATED']) },
        ...over,
      });

    it('provisions no App but still writes callers, seeds config, and opens the hand-off', async () => {
      const d = configured();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.resolveTarget).not.toHaveBeenCalled();
      expect(d.resolveApp).not.toHaveBeenCalled();
      expect(d.provisionSecrets).not.toHaveBeenCalled();
      expect(d.writeCallerWorkflows).toHaveBeenCalledOnce();
      expect(d.openHandoff).toHaveBeenCalledOnce();
    });

    it('creates the ruleset on the resume once the producer is on the default branch', async () => {
      const d = configured({
        gh: {
          ...fakeGh(),
          repoSecretNames: vi.fn(async () => [...SECRET_NAMES]),
          fileExistsOnRef: vi.fn(async () => true),
        },
      });
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.ensureWaiverStampRuleset).toHaveBeenCalledOnce();
    });
  });

  describe('reuse-org', () => {
    const reuse = (over: Partial<SetupDeps> = {}) =>
      makeDeps({
        resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
        resolveApp: vi.fn(async () => ({
          source: 'reuse-org' as const,
          slug: 'waiver-stamp-acme',
        })),
        ...over,
      });

    it('widens the org secrets and puts install on the hand-off page, then configures the repo half', async () => {
      const d = reuse();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.provisionSecrets).not.toHaveBeenCalled();
      expect(d.grantExistingOrgSecrets).toHaveBeenCalledOnce();
      // Reuse opens no install tab of its own — the slug rides the hand-off page's install step.
      expect(d.openBrowser).not.toHaveBeenCalled();
      expect(d.handoffPage).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'waiver-stamp-acme' }),
      );
      expect(d.openHandoff).toHaveBeenCalledOnce();
      expect(d.writeCallerWorkflows).toHaveBeenCalledOnce();
    });
  });

  describe('disk', () => {
    it('writes the repo secrets from the saved key and puts install on the hand-off page', async () => {
      const d = makeDeps({
        resolveApp: vi.fn(async () => ({
          source: 'disk' as const,
          appId: 3,
          pem: 'DISK-PEM',
          slug: 'renamed-by-hand',
        })),
      });
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.provisionSecrets).toHaveBeenCalledOnce();
      expect(d.openBrowser).not.toHaveBeenCalled();
      expect(d.handoffPage).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'renamed-by-hand' }),
      );
    });
  });

  // Finding #5: the App exists on GitHub the moment conversion succeeds, so a failed secret write
  // leaves an orphan the user can only clean up if we tell them where it is.
  it('names the orphaned App when the secret write fails after creation', async () => {
    const err = await setupRepository(
      { cwd: '/repo' },
      makeDeps({
        provisionSecrets: vi.fn(async () => {
          throw new Error('HTTP 403');
        }),
      }),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'SetupError' });
    expect((err as { remediation: string }).remediation).toContain(
      'https://github.com/settings/apps/waiver-stamp-jsalvata',
    );
  });
});
