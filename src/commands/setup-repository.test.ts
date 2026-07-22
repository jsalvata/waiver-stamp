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

  it('provisions the App and secrets, then guides install in the same tab', async () => {
    const provisionSecrets = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    const info = vi.fn();
    await setupRepository({ cwd: '/repo' }, makeDeps({ provisionSecrets, openBrowser, info }));
    expect(provisionSecrets).toHaveBeenCalledOnce();
    // resolveApp (mocked here) owns the single browser open on the fresh path; the orchestrator
    // must not spawn a second install tab — the done page forwards to install in that same tab.
    expect(openBrowser).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/install/i));
  });

  it('an org-owned repo without the admin:org scope fails before creating the App', async () => {
    const resolveApp = vi.fn(async () => ({
      source: 'fresh' as const,
      appId: 1,
      pem: 'p',
      slug: 's',
    }));
    const gh: GhClient = { ...fakeGh(), tokenScopes: vi.fn(async () => ['repo', 'read:org']) };
    const err = await setupRepository(
      { cwd: '/repo' },
      makeDeps({
        resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
        gh,
        resolveApp,
      }),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'SetupError', message: expect.stringMatching(/admin:org/) });
    expect(resolveApp).not.toHaveBeenCalled();
  });

  it('an org-owned repo with the admin:org scope proceeds to provisioning', async () => {
    const resolveApp = vi.fn(async () => ({
      source: 'fresh' as const,
      appId: 1,
      pem: 'p',
      slug: 's',
    }));
    const gh: GhClient = { ...fakeGh(), tokenScopes: vi.fn(async () => ['repo', 'admin:org']) };
    await setupRepository(
      { cwd: '/repo' },
      makeDeps({
        resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
        gh,
        resolveApp,
      }),
    );
    expect(resolveApp).toHaveBeenCalledOnce();
  });

  it('--no-app skips provisioning entirely', async () => {
    const resolveApp = vi.fn(async () => ({
      source: 'fresh' as const,
      appId: 0,
      pem: '',
      slug: '',
    }));
    const provisionSecrets = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    await setupRepository(
      { cwd: '/repo', noApp: true },
      makeDeps({ resolveApp, provisionSecrets, openBrowser }),
    );
    expect(resolveApp).not.toHaveBeenCalled();
    expect(provisionSecrets).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  // Re-running on a configured repo has to converge, not mint a duplicate App (design §1). The
  // signal is repo-scope secrets; an org-configured repo carries none, and reaches reuse-org.
  describe('already provisioned', () => {
    const configured = (over: Partial<SetupDeps> = {}) =>
      makeDeps({
        gh: { ...fakeGh(), repoSecretNames: vi.fn(async () => [...SECRET_NAMES, 'UNRELATED']) },
        ...over,
      });

    it('provisions nothing — not even resolving the target', async () => {
      const d = configured();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.resolveTarget).not.toHaveBeenCalled();
      expect(d.resolveApp).not.toHaveBeenCalled();
      expect(d.provisionSecrets).not.toHaveBeenCalled();
    });

    // Secrets present but no installation is the likeliest half-finished state — someone closed
    // the browser before the Install click. Silently no-opping would fail exactly that person.
    it('still points at the install step', async () => {
      const info = vi.fn();
      await setupRepository({ cwd: '/repo' }, configured({ info }));
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/install/i));
    });

    it('provisions normally when only one of the two secrets is there', async () => {
      const d = makeDeps({
        gh: { ...fakeGh(), repoSecretNames: vi.fn(async () => [SECRET_NAMES[0]]) },
      });
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.resolveApp).toHaveBeenCalledOnce();
    });
  });

  describe('reuse-org', () => {
    const reuse = () =>
      makeDeps({
        resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
        resolveApp: vi.fn(async () => ({
          source: 'reuse-org' as const,
          slug: 'waiver-stamp-acme',
        })),
      });

    it('widens the existing org secrets instead of rewriting them', async () => {
      const d = reuse();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.provisionSecrets).not.toHaveBeenCalled();
      expect(d.grantExistingOrgSecrets).toHaveBeenCalledWith(d.gh, {
        org: 'acme',
        owner: 'jsalvata',
        repo: 'demo',
        info: d.info,
      });
    });

    // Reuse skips the manifest flow, so no loopback served a guidance page — the orchestrator
    // shows one itself before the install link, rather than dropping the user onto raw GitHub.
    it('guides install via a local page, since no browser flow ran', async () => {
      const d = reuse();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.openInstallGuidance).toHaveBeenCalledWith(
        'https://github.com/apps/waiver-stamp-acme/installations/new',
        'jsalvata/demo',
      );
    });

    it('falls back to the org install settings when the App slug is unknown', async () => {
      const d = makeDeps({
        resolveTarget: vi.fn(async () => ({ kind: 'org' as const, org: 'acme' })),
        resolveApp: vi.fn(async () => ({ source: 'reuse-org' as const })),
      });
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.openInstallGuidance).toHaveBeenCalledWith(
        'https://github.com/organizations/acme/settings/installations',
        'jsalvata/demo',
      );
    });
  });

  describe('disk', () => {
    const disk = () =>
      makeDeps({
        resolveApp: vi.fn(async () => ({
          source: 'disk' as const,
          appId: 3,
          pem: 'DISK-PEM',
          slug: 'renamed-by-hand',
        })),
      });

    it('writes the repo secrets from the saved key and opens the install page', async () => {
      const d = disk();
      await setupRepository({ cwd: '/repo' }, d);
      expect(d.provisionSecrets).toHaveBeenCalledWith(d.gh, {
        target: { kind: 'personal' },
        appId: 3,
        pem: 'DISK-PEM',
        owner: 'jsalvata',
        repo: 'demo',
      });
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
