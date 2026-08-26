import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { WorkspaceSuccess } from "../../contracts/auth-workspace/workspace.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { GetWorkspaceQuery } from "./get-workspace.query.ts";

export class GetWorkspaceHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    query: GetWorkspaceQuery,
  ): Promise<AuthProblemResult | WorkspaceSuccess> {
    const { request } = query;
    const { repositories } = this;
    const correlationId =
      request.correlationId ?? this.support.createCorrelationId();
    const sessionToken = request.session_token;
    if (!sessionToken) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessDenied,
        actor_id: null,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.authRequired,
        correlationId: correlationId,
      });
      return createProblemResult(AUTH_ERROR_CODES.authRequired, correlationId);
    }

    const session = await this.support.findValidSession(
      repositories,
      sessionToken,
    );
    if (!session) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessDenied,
        actor_id: null,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.sessionInvalid,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    const user = await this.support.resolveUserById(
      repositories,
      session.userId,
    );
    if (!user) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessDenied,
        actor_id: session.userId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.sessionInvalid,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    const mfaEnrollment = await this.support.findMfaEnrollment(
      repositories,
      session.userId,
    );
    const mfaRequired = this.support.isMfaRequired(user, mfaEnrollment);
    if (mfaRequired && !session.isMfaVerified()) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessDenied,
        actor_id: session.userId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.mfaRequired,
        correlationId: correlationId,
      });
      return createProblemResult(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const authorization = await this.support.authorizeWorkspace(
      repositories,
      user,
      correlationId,
    );
    if (authorization.ok === false) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessDenied,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: authorization.problem.code,
        correlationId: correlationId,
      });
      return authorization;
    }

    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessAllowed,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    return {
      ok: true,
      user_id: user.id,
      display_name: user.displayName ?? user.email.toString(),
      role: authorization.role,
      session_expires_at: new Date(session.expiresAt).toISOString(),
      mfa_verified: session.isMfaVerified(),
      correlationId: correlationId,
    };
  }
}
