import { Inject } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import {
  AUTH_FAILURE_REASONS,
  authFailure,
} from "../../errors/auth-application.error.ts";
import type { RevokeOwnedSessionSuccess } from "../../contracts/auth/settings.contract.ts";
import {
  AUTH_SESSION_REPOSITORY,
  type SessionRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { RevokeOwnedSessionCommand } from "./revoke-owned-session.command.ts";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { SessionManagementService } from "../../services/auth/session-management.service.ts";

/**
 * Handles revoking a specific session owned by the authenticated user.
 *
 * Enforces:
 * 1. Verifies the target session ID exists and belongs to the authenticated user (`command.context.userId`).
 * 2. Throws 404 application failure if session is not found or owned by another user.
 * 3. Idempotently marks session as revoked.
 */
@CommandHandler(RevokeOwnedSessionCommand)
export class RevokeOwnedSessionHandler implements ICommandHandler<RevokeOwnedSessionCommand> {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    private readonly support: AuthSupportService,
    private readonly policy: SessionManagementService,
  ) {}

  /**
   * Business purpose: Revoke one session belonging to the authenticated account.
   * Business rules:
   * - Require recent backend-confirmed step-up before the owner-scoped mutation.
   * - Unknown and foreign session IDs have the same not-found result; repeat revocation is safe.
   * Execution flow:
   * 1. Validate the caller and reauthentication proof.
   * 2. Revoke the target only within the caller's account and acknowledge its ID.
   * Failure cases:
   * - Authorization failure prevents mutation; absent targets return NOT_FOUND, not SESSION_INVALID.
   * Side effects:
   * - Persists the target revocation; never returns a session token or proof.
   */
  async execute(
    command: RevokeOwnedSessionCommand,
  ): Promise<RevokeOwnedSessionSuccess> {
    const correlationId =
      command.requestMeta.correlationId ?? this.support.createCorrelationId();
    await this.policy.authorize(
      command.context,
      this.support.now(),
      correlationId,
    );
    const owned = await this.sessions.revokeOwned(
      command.sessionId,
      command.context.userId,
      this.support.now(),
    );
    if (!owned) {
      throw authFailure(SHARED_ERROR_CODES.notFound, correlationId, {
        reason: AUTH_FAILURE_REASONS.resourceNotFound,
      });
    }

    return {
      ok: true,
      revoked_session_id: command.sessionId,
    };
  }
}
