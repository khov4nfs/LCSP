import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.ts";
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

@CommandHandler(ReauthenticatePasswordCommand)
export class ReauthenticatePasswordHandler implements ICommandHandler<ReauthenticatePasswordCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  async execute(
    command: ReauthenticatePasswordCommand,
  ): Promise<PasswordReauthSuccess> {
    const { password, userId, sessionId, requestMeta } = command;
    const { sessions, users } = this;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (typeof password !== "string" || password.trim().length === 0) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

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
