/** Error types for waiver-stamp. Data lives in structured properties, never interpolated into messages. */

/** A waiver file could not be parsed as JSON. */
export class WaiverParseError extends Error {
  override readonly name = 'WaiverParseError';
  constructor(
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    super('Waiver file is not valid JSON', options);
  }
}

/** A waiver does not conform to the v0 JSON Schema. */
export class WaiverValidationError extends Error {
  override readonly name = 'WaiverValidationError';
  constructor(readonly errors: string[]) {
    super('Waiver failed schema validation');
  }
}

/** An engine operation that the v0 scaffold does not yet implement. */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor(readonly feature: string) {
    super('Not implemented in the v0 scaffold');
  }
}

/** A selector did not resolve to exactly one declaration in the loaded program (§5.2). */
export class SelectorResolutionError extends Error {
  override readonly name = 'SelectorResolutionError';
  constructor(
    readonly selector: string,
    readonly detail: string,
  ) {
    super('Selector did not resolve to exactly one declaration');
  }
}

/** An engine operation could not be applied (collision, ambiguity, unsupported shape). */
export class OpApplicationError extends Error {
  override readonly name = 'OpApplicationError';
  constructor(
    readonly opKind: string,
    readonly detail: string,
  ) {
    super('Operation could not be applied');
  }
}

/** `waiver commit` refuses to run against a working tree with tracked changes (§17.4). */
export class DirtyTreeError extends Error {
  override readonly name = 'DirtyTreeError';
  constructor(readonly cwd: string) {
    super('Working tree has tracked changes; commit or stash them first');
  }
}

/** A commit-ish argument did not resolve to a commit (§10 malformed invocation). */
export class CommitResolutionError extends Error {
  override readonly name = 'CommitResolutionError';
  constructor(readonly ref: string) {
    super('Argument did not resolve to a commit');
  }
}
