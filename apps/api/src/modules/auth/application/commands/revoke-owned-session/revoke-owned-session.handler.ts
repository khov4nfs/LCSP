import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus, Inject } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import type { RevokeOwnedSessionSuccess } from "../../contracts/auth/settings.contract.ts";
import {
  AUTH_SESSION_REPOSITORY,
  type SessionRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { RevokeOwnedSessionCommand } from "./revoke-owned-session.command.ts";

/**
 * Handles revoking a specific session owned by the authenticated user.
 *
 * Enforces:
 * 1. Verifies the target session ID exists and belongs to the authenticated user (`command.context.userId`).
 * 2. Throws 404 problemException if session is not found or owned by another user.
 * 3. Idempotently marks session as revoked.
 */
@CommandHandler(RevokeOwnedSessionCommand)
export class RevokeOwnedSessionHandler implements ICommandHandler<RevokeOwnedSessionCommand> {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    private readonly support: AuthSupportService,
  ) {}

  /**
   * Executes revocation of an owned session.
   *
   * @param command - Contains target sessionId, caller auth context, and request metadata.
   * @returns Success response with revoked session ID.
   */
  async execute(
    command: RevokeOwnedSessionCommand,
  ): Promise<RevokeOwnedSessionSuccess> {
    const correlationId =
      command.requestMeta.correlationId ?? this.support.createCorrelationId();
    const owned = await this.sessions.revokeOwned(
      command.sessionId,
      command.context.userId,
      this.support.now(),
    );
    if (!owned) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    return {
      ok: true,
      revoked_session_id: command.sessionId,
    };
  }
}
