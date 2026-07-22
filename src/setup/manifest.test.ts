import { describe, expect, it } from 'vitest';
import { appSlugName, buildManifest } from './manifest.ts';

describe('appSlugName', () => {
  it('suffixes the owner login in the slug charset', () => {
    expect(appSlugName('jsalvata')).toBe('waiver-stamp-jsalvata');
  });
  it('lowercases and hyphenates non-alphanumerics', () => {
    expect(appSlugName('My_Org.Name')).toBe('waiver-stamp-my-org-name');
  });
  it('caps length and appends a short deterministic hash for long owners', () => {
    const name = appSlugName('a'.repeat(60));
    expect(name.length).toBeLessThanOrEqual(34);
    expect(name.startsWith('waiver-stamp-')).toBe(true);
    expect(appSlugName('a'.repeat(60))).toBe(name); // deterministic
  });

  // App names are globally unique, so an App dedicated to one repo can't take the account-wide
  // name — the owner may already hold it from an earlier repo.
  it('folds the repo in when the App is dedicated to one', () => {
    expect(appSlugName('jsalvata', 'demo')).toBe('waiver-stamp-jsalvata-demo');
    expect(appSlugName('jsalvata', 'demo')).not.toBe(appSlugName('jsalvata'));
  });

  it('caps the dedicated name too, hashing owner and repo together', () => {
    const name = appSlugName('a'.repeat(30), 'b'.repeat(30));
    expect(name.length).toBeLessThanOrEqual(34);
    expect(name).toBe(appSlugName('a'.repeat(30), 'b'.repeat(30)));
    // Two repos under one long owner must not collapse to the same truncated name.
    expect(name).not.toBe(appSlugName('a'.repeat(30), 'c'.repeat(30)));
  });
});

describe('buildManifest', () => {
  it('carries the exact scopes and no events/webhook', () => {
    const m = buildManifest({
      owner: 'jsalvata',
      appUrl: 'https://github.com/jsalvata/waiver-stamp',
    });
    expect(m.name).toBe('waiver-stamp-jsalvata');
    expect(m.public).toBe(false);
    expect(m.default_permissions).toEqual({
      contents: 'write',
      pull_requests: 'write',
      administration: 'read',
    });
    expect(m.default_events).toEqual([]);
  });
});
