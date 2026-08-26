import { Command } from "@nestjs/cqrs";

import type { GitHubAppStartDto } from "../../contracts/github-integration/github-app-start.contract.js";

/**
 * Carries the authenticated context required to begin or resume a GitHub App installation flow.
 */
export class GitHubAppStartCommand extends Command<GitHubAppStartDto> {
  /**
   * Creates a GitHub App start command.
   *
   * @param userId - Authenticated user initiating the installation flow.
   * @param redirectUri - Optional client redirect URI to restore after GitHub authorization.
   * @param assessmentId - Optional assessment that should receive the resulting repository connection.
   * @param correlationId - Correlation identifier propagated through installation state and audit events.
   * @param sessionId - Authenticated session bound to the installation state.
   * @param installationId - Optional existing GitHub installation identifier when reconnecting/resuming.
   */
  constructor(
    public readonly userId: string,
    public readonly redirectUri: string | undefined,
    public readonly assessmentId: string | undefined,
    public readonly correlationId: string,
    public readonly sessionId: string,
    public readonly installationId?: string,
  ) {
    super();
  }
}
