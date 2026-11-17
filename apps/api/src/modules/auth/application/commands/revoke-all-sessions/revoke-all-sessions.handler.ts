import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AUTH_SESSION_REPOSITORY,
  type SessionRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { SessionManagementService } from "../../services/auth/session-management.service.ts";
import { RevokeAllSessionsCommand } from "./revoke-all-sessions.command.ts";

@CommandHandler(RevokeAllSessionsCommand)
export class RevokeAllSessionsHandler implements ICommandHandler<RevokeAllSessionsCommand> {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    private readonly support: AuthSupportService,
    private readonly policy: SessionManagementService,
  ) {}

  /**
   * Business purpose: End all existing active sessions of the authenticated account.
   * Business rules:
   * - Recent reauthentication is mandatory; the caller cannot select another account.
   * - Include the current session and use one owner-scoped database update.
   * Execution flow:
   * 1. Authorize the calling session and current proof.
   * 2. Revoke the owner's active sessions, then acknowledge completion.
   * Failure cases:
   * - Authorization or persistence failure propagates without a success acknowledgment.
   * Side effects:
   * - Revokes sessions including the caller; subsequent requests must authenticate again.
   */
  async execute(command: RevokeAllSessionsCommand) {
    const correlationId =
      command.requestMeta.correlationId ?? this.support.createCorrelationId();
    const now = this.support.now();
    await this.policy.authorize(command.context, now, correlationId);
    await this.sessions.revokeAllForUser(command.context.userId, now);
    return { ok: true as const, revoked_all: true as const };
  }
}
