#!/usr/bin/env bash
# Called by semantic-release (prepare) with the version it is about to publish.
#
# Rewrites every version-bearing string in the artifacts an adopter copy-pastes, so a
# pasted template pins a ref that exists and the prose around it agrees:
#
#   examples/waiver-stamp-ci.yml      producer `uses:` pin
#   examples/waiver-stamp-review.yml  reviewer `uses:` pin (incl. the copy quoted in the
#                                     SECURITY header)
#   docs/auto-approval-setup.md       the pin named in the setup guide
#
# Two distinct shapes carry the version, and MISSING ONE is the failure mode this script
# exists to prevent — a template pinned to the new release while the `gh api …/commits/vX`
# line beside it still names the old one is worse than either alone, because the reader
# cannot tell which is authoritative:
#
#   @v1.2.3                    the tag pin itself (and bare `@v1.2.3` in prose)
#   commits/v1.2.3             the `gh api …/commits/<tag>` tag→SHA one-liner
#
# NB we do NOT rewrite a CLI version inside action.yml. Unlike lockfile-assay, which pins
# `VERSION="x.y.z"` in its action, our producer resolves the CLI release from its OWN
# checkout at the pinned ref (.github/actions/waiver-stamp/action.yml) — self-maintaining,
# with no second pin to drift.
#
# Every edit is verified below: a silently-failed rewrite must fail the release rather than
# ship templates pointing at a version that was never published. src/action/pins.test.ts is
# the same check from the other side, and fails CI if this script ever stops covering a file.
set -euo pipefail

VER="${1:?usage: set-release-version.sh <version>}"

FILES=(
  examples/waiver-stamp-ci.yml
  examples/waiver-stamp-review.yml
  docs/auto-approval-setup.md
)

SEMVER='[0-9]+\.[0-9]+\.[0-9]+'
# The three shapes above. Anchored on their prefixes so that `actions/checkout@v4` (no
# patch/minor) and the node versions in the `ci-checks` matrix example (`9.12.0`, bare) are
# both left alone — only OUR version is ever rewritten.
PATTERNS=(
  "@v${SEMVER}"
  "commits/v${SEMVER}"
)
REPLACEMENTS=(
  "@v${VER}"
  "commits/v${VER}"
)

# NB: no `sed -i`. It is not portable — GNU takes no argument, while BSD/macOS consumes the
# next token as a backup suffix and so silently swallows `-E`, dropping to basic regexes.
# Rewrite via a temp file so this behaves identically on the Linux release runner and on a
# maintainer's Mac.
for f in "${FILES[@]}"; do
  for i in "${!PATTERNS[@]}"; do
    sed -E "s|${PATTERNS[$i]}|${REPLACEMENTS[$i]}|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
done

# Verify: every version-bearing token in every file now names exactly VER, and each file
# still has at least one. Catches a pattern that went stale (a rename, a reformat) — which
# would otherwise ship a template silently pinned to an older release.
ALL_ERE="$(IFS='|'; echo "${PATTERNS[*]}")"
for f in "${FILES[@]}"; do
  # `|| true`: grep exits 1 on no-match, which under `set -e` would kill the script before
  # it could report *which* file lost its pin — the diagnosis matters more than the exit.
  found="$(grep -Eo "${ALL_ERE}" "$f" | grep -Eo "${SEMVER}" | sort -u || true)"
  [ -n "$found" ] || { echo "FATAL: no version pin found in $f — did the patterns go stale?" >&2; exit 1; }
  [ "$found" = "$VER" ] || {
    echo "FATAL: $f still names version(s) [$(echo "$found" | tr '\n' ' ')], expected ${VER}" >&2
    exit 1
  }
done

echo "pinned v${VER} in: ${FILES[*]}"
