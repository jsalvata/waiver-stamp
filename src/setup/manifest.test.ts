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
