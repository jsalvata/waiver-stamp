/** Conventional Commits — drives semantic-release versioning. */
export default {
  extends: ['@commitlint/config-conventional'],
  // Waivered commits embed a machine ```waiver block in the body; its JSON lines can
  // exceed 100 chars. The block is not prose, so the body line-length rule is disabled.
  rules: { 'body-max-line-length': [0, 'always', Infinity] },
};
