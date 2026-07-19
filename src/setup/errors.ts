/** A preflight/setup failure carrying a user-facing remediation. Mapped to EXIT.MALFORMED (spec §4.12). */
export class SetupError extends Error {
  override readonly name = 'SetupError';
  constructor(
    message: string,
    readonly remediation: string,
  ) {
    super(message);
  }
}
