/**
 * Error type for the e2e harness. Static message, contextual data in `extra` — never
 * interpolated into the message string — so a failure is greppable by its fixed text
 * (matches `src/errors.ts`'s convention for this repo's shipped error types).
 */
export class E2eHarnessError extends Error {
  override readonly name = 'E2eHarnessError';
  constructor(
    message: string,
    readonly extra?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
