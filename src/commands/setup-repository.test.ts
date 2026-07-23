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
  checkRunPresent: vi.fn(async () => false),
});

function makeDeps(over: Partial<SetupDeps> = {}): SetupDeps {
  return {
    preflight: vi.fn(async () => ctx),
    gh: fakeGh(),
    resolveTarget: vi.fn(async () => ({ kind: 'personal' as const })),
    resolveApp: vi.fn(async () => ({
      source: 'fresh' as const,
      appId: 42,
      pem: '-----BEGIN…',
      slug: 'waiver-stamp-jsalvata',
    })),
    provisionSecrets: vi.fn(async () => {}),
    grantExistingOrgSecrets: vi.fn(async () => {}),
    confirmYesNo: vi.fn(async () => false),
    openBrowser: vi.fn(async () => {}),
    openInstallGuidance: vi.fn(async () => {}),
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
    warn: vi.fn(),
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
    // The loopback done page owns the install tab on the fresh path — the orchestrator opens no
    // browser itself; only the hand-off page (via openHandoff) is its own.
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

    it('warns about each caller it left untouched', async () => {
      const warn = vi.fn();
      const d = makeDeps({
        warn,
        writeCallerWorkflows: vi.fn(async () => ({
          written: [],
          skipped: ['.github/workflows/waiver-stamp-ci.yml'],
        })),
      });
      await setupRepository({ cwd: '/repo' }, d);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('waiver-stamp-ci.yml'));
    });

    it('warns when commitlint would reject long waiver bodies', async () => {
      const warn = vi.fn();
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({ warn, detectCommitlintBodyLimit: vi.fn(async () => ({ blocks: true })) }),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/body-max-line-length/));
    });

    it('warns when no linter (or more than one) is declared for lint-fix', async () => {
      const none = vi.fn();
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          warn: none,
          detectLintFixLinter: vi.fn(async () => ({ status: 'none' as const, declared: [] })),
        }),
      );
      expect(none).toHaveBeenCalledWith(expect.stringMatching(/lint-fix/));

      const many = vi.fn();
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({
          warn: many,
          detectLintFixLinter: vi.fn(async () => ({
            status: 'ambiguous' as const,
            declared: ['@biomejs/biome', 'eslint'],
          })),
        }),
      );
      expect(many).toHaveBeenCalledWith(expect.stringMatching(/@biomejs\/biome, eslint/));
    });
  });

  describe('§4.13 phase boundary — the ruleset must not precede the producer', () => {
    it('creates no ruleset and points at the merge/re-run step when the check has not run', async () => {
      const info = vi.fn();
      const d = makeDeps({ info }); // checkRunPresent defaults to false
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.ensureWaiverStampRuleset).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/re-run/i));
    });

    it('creates the ruleset once the check has reported, after writing the callers', async () => {
      const gh: GhClient = { ...fakeGh(), checkRunPresent: vi.fn(async () => true) };
      const d = makeDeps({ gh });
      await setupRepository({ cwd: '/repo' }, d);
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
      const gh: GhClient = { ...fakeGh(), checkRunPresent: vi.fn(async () => true) };
      await setupRepository(
        { cwd: '/repo' },
        makeDeps({ info, gh, ensureWaiverStampRuleset: vi.fn(async () => 'exists' as const) }),
      );
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/ruleset exists/i));
    });
  });

  describe('hand-off page', () => {
    it('opens the hand-off page with the provisioned slug and config state', async () => {
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
      expect(openHandoff).toHaveBeenCalledWith('<handoff>');
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
  });

  it('an org-owned repo without the admin:org scope fails before creating the App', async () => {
    const gh: GhClient = { ...fakeGh(), tokenScopes: vi.fn(async () => ['repo', 'read:org']) };
    const d = makeDeps({
      resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
      gh,
    });
    const err = await setupRepository({ cwd: '/repo' }, d).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'SetupError', message: expect.stringMatching(/admin:org/) });
    expect(d.resolveApp).not.toHaveBeenCalled();
    // Failing fast means the config/workflow phase never ran either.
    expect(d.writeCallerWorkflows).not.toHaveBeenCalled();
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

    it('creates the ruleset on the resume once the producer has run', async () => {
      const d = configured({
        gh: {
          ...fakeGh(),
          repoSecretNames: vi.fn(async () => [...SECRET_NAMES]),
          checkRunPresent: vi.fn(async () => true),
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

    it('widens the org secrets and guides install, then configures the repo half', async () => {
      const d = reuse();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.provisionSecrets).not.toHaveBeenCalled();
      expect(d.grantExistingOrgSecrets).toHaveBeenCalledOnce();
      expect(d.openInstallGuidance).toHaveBeenCalledWith(
        'https://github.com/apps/waiver-stamp-acme/installations/new',
        'jsalvata/demo',
      );
      expect(d.writeCallerWorkflows).toHaveBeenCalledOnce();
    });
  });

  describe('disk', () => {
    it('writes the repo secrets from the saved key and guides install', async () => {
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
      expect(d.openInstallGuidance).toHaveBeenCalledWith(
        'https://github.com/apps/renamed-by-hand/installations/new',
        'jsalvata/demo',
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
