#!/bin/sh
# PreToolUse (Bash) drift guard. Before the agent runs a `git push`, re-verify any
# outgoing waivered dependency-bump commits so registry drift is caught here — where
# the agent can self-correct — instead of flaking in CI (§6.3). Belt-and-braces to the
# repo's own husky pre-push hook, and a fast no-op everywhere waiver-stamp isn't used.

# Explicit bypass — mirrors git's own `--no-verify`.
[ "${WAIVER_SKIP_PREPUSH:-}" = "1" ] && exit 0

# The tool call is JSON on stdin. We don't need a real parser: a conservative "is the
# command a git push?" scan of the `command` field is enough. False negatives are fine
# (this only backs up the husky hook); false positives cost one no-op `prepush` run.
input=$(cat)
printf '%s' "$input" \
  | grep -Eq '"command"[[:space:]]*:[[:space:]]*"[^"]*git[[:space:]]+push' \
  || exit 0

# Resolve the `waiver` binary from THIS repo only (never a global, never the network):
# if it isn't a dependency here, the plugin must be a silent no-op — it runs in every
# enabled repo. Prefer the local bin directly; fall back to `pnpm exec` for workspace
# layouts that hoist it. (`--help` probes resolvability without touching the registry;
# unlike `--version`, npx/pnpm don't intercept it.)
if [ -x node_modules/.bin/waiver ]; then
  set -- node_modules/.bin/waiver
elif command -v pnpm >/dev/null 2>&1 && pnpm exec waiver --help >/dev/null 2>&1; then
  set -- pnpm exec waiver
else
  exit 0
fi

# Re-verify. There are no git ref lines to feed here (this isn't git's pre-push hook),
# so `prepush` runs standalone (@{push}..HEAD); /dev/null keeps it off our stdin.
output=$("$@" prepush </dev/null 2>&1) && exit 0

# Verification failed (drift, or an otherwise-invalid waivered bump): block the push and
# hand the agent the failure + refresh recipe on stderr so it can fix and re-push.
printf '%s\n' "$output" >&2
exit 2
