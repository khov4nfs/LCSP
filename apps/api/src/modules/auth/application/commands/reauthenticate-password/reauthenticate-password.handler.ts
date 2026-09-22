import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { verifySecret } from "../../../infrastructure/security/security.utils.ts";
import type { PasswordReauthSuccess } from "../../contracts/auth/password-reauth.contract.ts";
import {
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { ReauthenticatePasswordCommand } from "./reauthenticate-password.command.ts";

/**
 * Handles password re-authentication (sudo mode) for sensitive account actions.
 *
 * Enforces:
 * 1. Valid, active session belonging to the authenticated user.
 * 2. Constant-time verification of user's current password.
 * 3. Marks session with `sensitiveActionVerifiedAt` timestamp upon success.
 * 4. Records audit trails for both success and failed password checks.
 */
@CommandHandler(ReauthenticatePasswordCommand)
export class ReauthenticatePasswordHandler implements ICommandHandler<ReauthenticatePasswordCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  /**
   * Executes password re-authentication for the active session.
   *
   * @param command - Contains current password, userId, sessionId, and request metadata.
   * @returns Verification success response.
   */
  async execute(
    command: ReauthenticatePasswordCommand,
  ): Promise<PasswordReauthSuccess> {
    const { password, userId, sessionId, requestMeta } = command;
    const { sessions, users } = this;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw problemException(AUTH_ERROR_CODES.authRequired, correlationId);
    }

    const session = await sessions.findById(sessionId);
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== userId
    ) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const user = await users.findById(userId);
    if (!user || user.id !== session.userId) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    if (!verifySecret(password, user.passwordHash)) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
        session_id: session.id,
      });
      throw problemException(
        AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
        { requiredAction: REQUIRED_ACTIONS.none },
      );
    }

    session.markSensitiveActionVerified(this.support.now());
    await sessions.save(session);

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
    });

    return {
      ok: true,
      correlationId: correlationId,
      verified: true,
    };
  }
}
