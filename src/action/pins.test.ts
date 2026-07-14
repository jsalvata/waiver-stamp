import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Grep-level guards over the artifacts an adopter copy-pastes. Nothing else in the
// suite reads them: our own CI dogfoods the CLI directly (`node dist/cli.js`, see
// .github/workflows/ci.yml) and never loads the composite action or the templates,
// so a broken pin in here passes every other check and ships. These tests are the
// only thing standing between a bad pin and an adopter's write token.

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const TEMPLATES = ['examples/waiver-stamp-ci.yml', 'examples/waiver-stamp-review.yml'] as const;

/**
 * Every `uses: jsalvata/waiver-stamp/...@<ref>` ref in a file — including the ones quoted
 * inside comments, which an adopter is just as likely to copy as the live line.
 *
 * The ref charset is restricted to what a git ref can actually contain, rather than `\S+`:
 * these refs also appear inside backticks in prose, and `\S+` swallows the closing backtick
 * into the captured ref.
 */
function usesRefs(source: string): string[] {
  const pattern = /jsalvata\/waiver-stamp\/\.github\/actions\/[\w-]+@([\w.\-/]+)/g;
  return [...source.matchAll(pattern)].flatMap((m) => m[1] ?? []);
}

const TAG = /^v\d+\.\d+\.\d+$/;

// An adopter pins these refs and then trusts whatever they resolve to — the reviewer
// runs with `pull-requests: write`. A MUTABLE ref (a branch, `@main`, or a leftover
// `<COMMIT_SHA>` placeholder that someone "fixed" by pointing at a branch) would let
// the code holding that token change without the adopter re-pinning. The templates
// therefore ship pinned to a release tag, kept current by scripts/set-release-version.sh
// on every release (a `v*` tag is immutable: a repo ruleset restricts update+deletion).
describe('the copy-paste templates pin an immutable ref', () => {
  it.each(TEMPLATES)('%s pins every action to a release tag', (file) => {
    const refs = usesRefs(read(file));
    expect(refs.length).toBeGreaterThan(0); // regex went stale ⇒ the guard is not guarding
    for (const ref of refs) expect(ref).toMatch(TAG);
  });

  it('pins the same version across every template', () => {
    const refs = TEMPLATES.flatMap((f) => usesRefs(read(f)));
    expect(new Set(refs).size).toBe(1);
  });

  it('pins the version this repo last released', () => {
    // set-release-version.sh (semantic-release `prepare`) rewrites the templates to the
    // version being published, so the committed tree always agrees with package.json. A
    // mismatch means the rewrite silently no-op'd and the templates point at an older
    // release than the docs around them claim.
    const version = JSON.parse(read('package.json')).version;
    const refs = TEMPLATES.flatMap((f) => usesRefs(read(f)));
    for (const ref of refs) expect(ref).toBe(`v${version}`);
  });
});

// The `uses:` pin is not the only place the version appears: the guide and the templates also
// name it in the `gh api …/commits/<tag>` one-liner. A release that bumped the pin but not the
// prose beside it would be worse than either alone — a reader cannot tell which of two versions
// is authoritative. So assert the whole set moves together. (This is the check that catches
// set-release-version.sh silently ceasing to cover a file.)
describe('every version-bearing string tracks the released version', () => {
  const PINNED = [...TEMPLATES, 'docs/auto-approval-setup.md'] as const;

  // Anchored on their prefixes, so `actions/checkout@v4` and the node versions in the
  // ci-checks matrix example (`integration (9.12.0)`) are correctly left out — they are not
  // our version and must never be rewritten.
  const SHAPES = /@v(\d+\.\d+\.\d+)|commits\/v(\d+\.\d+\.\d+)/g;

  it.each(PINNED)('%s names only the released version', (file) => {
    const version = JSON.parse(read('package.json')).version;
    const found = [...read(file).matchAll(SHAPES)].flatMap((m) => m[1] ?? m[2] ?? []);
    expect(found.length).toBeGreaterThan(0); // a file that lost its pin entirely
    expect([...new Set(found)]).toEqual([version]);
  });
});

// The sharpest edge in the repo (fixed in #32): the producer action installs the CLI at run
// time, so if it installed an UNPINNED package the adopter's careful `@v1.11.2` would pin the
// action but not the code that computes the verdict — the tool would float with npm's `latest`
// while the adopter believed they were pinned. It resolves the version from its own checkout at
// the pinned ref instead, and takes NO input that could override that: the only things such an
// input could express are a float or an action/CLI mismatch, both of which quietly surrender the
// property the adopter pinned for. These guards fail the build if anyone reopens either door.
describe('the producer action pins the CLI it installs', () => {
  const actionYml = () => read('.github/actions/waiver-stamp/action.yml');

  it('exposes no input that could select a different CLI version', () => {
    expect(actionYml()).not.toMatch(/^inputs:/m);
    expect(actionYml()).not.toMatch(/waiver-version/);
  });

  it('resolves the version from its own checkout at the pinned ref', () => {
    expect(actionYml()).toMatch(/GITHUB_ACTION_PATH.*package\.json/);
  });

  it('never installs the CLI unpinned', () => {
    // every `waiver-stamp@…` install must carry the resolved version, not a bare name or `latest`
    expect(actionYml()).not.toMatch(/waiver-stamp@latest/);
    expect(actionYml()).not.toMatch(/npx\s+(--yes\s+)?waiver-stamp(?!@)/);
  });
});
