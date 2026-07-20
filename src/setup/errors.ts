/** A preflight/setup failure carrying a user-facing remediation. Mapped to EXIT.MALFORMED (spec §4.12). */
export class SetupError extends Error {
  override readonly name = 'SetupError';
  constructor(
    message: string,
    readonly remediation: string,
    /** Raw underlying output (e.g. a failed `gh` response) to include when asking the user to report it. */
    readonly details?: string,
  ) {
    super(message);
  }
}
