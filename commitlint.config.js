/** Conventional Commits — drives semantic-release versioning. */
export default {
  extends: ['@commitlint/config-conventional'],
  // Waivered commits embed a machine ```waiver block in the body; its JSON lines can
  // exceed 100 chars. The block is not prose, so the body line-length rule is disabled.
  rules: { 'body-max-line-length': [0, 'always', Number.POSITIVE_INFINITY] },
  // semantic-release's own `chore(release):` commit is machine-generated: its body is the
  // rendered changelog, whose entries (commit-SHA + issue links) routinely run past the
  // footer line-length limit. That commit passes through this same commit-msg hook during
  // the release job, so exempt it — linting the bot's changelog only ever blocks a release.
  // Added to commitlint's default ignores (merge/revert/…), not replacing them.
  ignores: [(message) => message.startsWith('chore(release)')],
};
