import { Command } from "@nestjs/cqrs";

import type { GitHubAppCallbackDto } from "../../contracts/github-integration/github-app-callback.contract.js";

/**
 * Carries GitHub App installation callback values into the CQRS command pipeline.
 */
export class GitHubAppCallbackCommand extends Command<GitHubAppCallbackDto> {
  /**
   * Creates a GitHub App callback command.
   *
   * @param installationId - GitHub App installation identifier returned by GitHub.
   * @param code - Callback authorization code used to complete the GitHub flow.
   * @param state - Opaque installation state used to recover and verify the original request context.
   * @param correlationId - Correlation identifier propagated to callback errors and audit events.
   * @param repositoryId - Optional repository identifier selected during the installation flow.
   */
  constructor(
    public readonly installationId: string,
    public readonly code: string,
    public readonly state: string,
    public readonly correlationId: string,
    public readonly repositoryId?: string,
  ) {
    super();
  }
}
