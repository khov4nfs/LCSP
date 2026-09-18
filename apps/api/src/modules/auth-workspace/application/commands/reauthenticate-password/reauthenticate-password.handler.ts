import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  REQUIRED_ACTIONS,
  createProblemResult,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { verifySecret } from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { PasswordReauthSuccess } from "../../contracts/auth-workspace/password-reauth.contract.ts";
import {
  AUTH_WORKSPACE_REPOSITORIES,
  type AuthWorkspaceRepositories,
} from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { ReauthenticatePasswordCommand } from "./reauthenticate-password.command.ts";

@CommandHandler(ReauthenticatePasswordCommand)
export class ReauthenticatePasswordHandler implements ICommandHandler<ReauthenticatePasswordCommand> {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    @Inject(AUTH_WORKSPACE_REPOSITORIES)
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: ReauthenticatePasswordCommand,
  ): Promise<AuthProblemResult | PasswordReauthSuccess> {
    const { password, userId, sessionId, requestMeta } = command;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (typeof password !== "string" || password.trim().length === 0) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    if (!userId || !sessionId) {
      return createProblemResult(AUTH_ERROR_CODES.authRequired, correlationId);
    }

    const session = await this.repositories.sessions.findById(sessionId);
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== userId
    ) {
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    const user = await this.support.resolveUserById(this.repositories, userId);
    if (!user || user.id !== session.userId) {
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    if (!verifySecret(password, user.passwordHash)) {
      await this.support.recordAudit(this.repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
        session_id: session.id,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
        { requiredAction: REQUIRED_ACTIONS.none },
      );
    }

    session.markSensitiveActionVerified(this.support.now());
    await this.repositories.sessions.save(session);

    await this.support.recordAudit(this.repositories, {
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
