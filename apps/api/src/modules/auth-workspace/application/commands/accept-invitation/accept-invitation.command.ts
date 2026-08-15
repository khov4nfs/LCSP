/**
 * Carries invitation acceptance credentials and correlation context into the auth-workspace command pipeline.
 */
export class AcceptInvitationCommand {
  /**
   * Creates an invitation acceptance command.
   *
   * @param input - Invitation token plus optional display name, password, and request correlation identifier.
   */
  constructor(
    readonly input: {
      invitationToken?: string;
      displayName?: string;
      password?: string;
      correlationId?: string;
    },
  ) {}
}
