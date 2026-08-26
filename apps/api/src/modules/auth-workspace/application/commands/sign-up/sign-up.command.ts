/**
 * Carries self-registration credentials and correlation context into the auth-workspace command pipeline.
 */
export class SignUpCommand {
  /**
   * Creates a self-registration command.
   *
   * @param input - Account, password, and request correlation fields.
   */
  constructor(
    readonly input: {
      email?: unknown;
      displayName?: unknown;
      password?: unknown;
      correlationId?: string;
    },
  ) {}
}
