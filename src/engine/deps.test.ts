import { describe, expect, it } from 'vitest';
import { manifestBumpViolations, matchesAllowlist } from './deps.js';

describe('matchesAllowlist', () => {
  it('matches exact names', () => {
    expect(matchesAllowlist('lodash', ['lodash'])).toBe(true);
    expect(matchesAllowlist('lodash-es', ['lodash'])).toBe(false);
  });

  it('matches `@scope/*` as a scope prefix', () => {
    expect(matchesAllowlist('@myorg/foo', ['@myorg/*'])).toBe(true);
    expect(matchesAllowlist('@myorg-evil/foo', ['@myorg/*'])).toBe(false);
    expect(matchesAllowlist('@myorg', ['@myorg/*'])).toBe(false);
  });
});

describe('manifestBumpViolations', () => {
  const allow = ['lodash', '@myorg/*'];
  const base = {
    name: 'fixture',
    dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0' },
    devDependencies: { '@myorg/a': '1.0.0' },
    scripts: { build: 'tsc' },
  };

  it('accepts an allowlisted up-move (caret major bump)', () => {
    const head = { ...base, dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([]);
  });

  it('accepts an exact-pin up-move', () => {
    const head = { ...base, dependencies: { lodash: '1.5.0', 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([]);
  });

  it('accepts identical manifests', () => {
    expect(manifestBumpViolations(base, base, allow)).toEqual([]);
  });

  it('rejects a change to a non-allowlisted package', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0', 'left-pad': '^2.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: 'left-pad' is not on allowBumping",
    ]);
  });

  it('rejects an added dependency', () => {
    const head = {
      ...base,
      dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0', '@myorg/new': '1.0.0' },
    };
    expect(manifestBumpViolations(base, head, allow)).toEqual(["dependencies: '@myorg/new' added"]);
  });

  it('rejects a removed dependency', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual(["dependencies: 'left-pad' removed"]);
  });

  it('rejects a change to a non-dependency field', () => {
    const head = { ...base, scripts: { build: 'tsc', evil: 'curl x | sh' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual(["field 'scripts' changed"]);
  });

  it('rejects a downward move (widening below base floor)', () => {
    const head = { ...base, dependencies: { lodash: '>=0.1.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('below base floor');
  });

  it('rejects a re-widening union that re-admits low versions', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0 || >=0.0.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('below base floor');
  });

  it('rejects a protocol/alias specifier (not plain semver)', () => {
    const head = { ...base, dependencies: { lodash: 'npm:evil@1.0.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('not plain semver');
  });

  it('rejects a non-string version value', () => {
    const head = { ...base, dependencies: { lodash: { evil: true }, 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: 'lodash' is not a version string",
    ]);
  });
});
