export type SignUpCommandInput = {
  email: string;
  displayName: string;
  password: string;
  correlationId?: string;
};

/**
 * Carries self-registration credentials and correlation context into the auth-workspace command pipeline.
 */
export class SignUpCommand {
  /**
   * Creates a self-registration command.
   *
   * @param input - Account, password, and request correlation fields.
   */
  constructor(readonly input: SignUpCommandInput) {}
}
