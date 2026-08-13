import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import { verifySecret } from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { PasswordReauthSuccess } from "../../contracts/auth-workspace/password-reauth.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { ReauthenticatePasswordCommand } from "./reauthenticate-password.command.ts";

export class ReauthenticatePasswordHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: ReauthenticatePasswordCommand,
  ): Promise<AuthProblemResult | PasswordReauthSuccess> {
    const { payload, requestMeta } = command;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    if (
      typeof payload.session_token !== "string" ||
      payload.session_token.trim().length === 0
    ) {
      return createProblemResult(AUTH_ERROR_CODES.authRequired, correlationId);
    }

    if (
      typeof payload.password !== "string" ||
      payload.password.trim().length === 0
    ) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    const session = await this.support.findValidSession(
      this.repositories,
      payload.session_token,
    );
    if (!session) {
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    const user = await this.support.resolveUserById(
      this.repositories,
      session.userId,
    );
    if (!user) {
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    if (!verifySecret(payload.password, user.passwordHash)) {
      await this.support.recordAudit(this.repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        organization_id: session.organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
        session_id: session.id,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
      );
    }

    session.markSensitiveActionVerified(this.support.now());
    await this.repositories.sessions.save(session);

    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
      actor_id: user.id,
      organization_id: session.organizationId,
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
