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
