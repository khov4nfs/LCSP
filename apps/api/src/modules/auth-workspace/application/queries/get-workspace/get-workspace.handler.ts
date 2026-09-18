import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.ts";
import type { WorkspaceSuccess } from "../../contracts/auth-workspace/workspace.contract.ts";
import {
  AUTH_WORKSPACE_REPOSITORIES,
  type AuthWorkspaceRepositories,
} from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { GetWorkspaceQuery } from "./get-workspace.query.ts";

@QueryHandler(GetWorkspaceQuery)
export class GetWorkspaceHandler implements IQueryHandler<GetWorkspaceQuery> {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    @Inject(AUTH_WORKSPACE_REPOSITORIES)
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(query: GetWorkspaceQuery): Promise<WorkspaceSuccess> {
    const { context, correlationId } = query;
    const { repositories } = this;
    const cid = correlationId ?? this.support.createCorrelationId();

    const user = await this.support.resolveUserById(
      repositories,
      context.userId,
    );
    if (!user) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessDenied,
        actor_id: context.userId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.sessionInvalid,
        correlationId: cid,
      });
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, cid);
    }

    const session = await this.repositories.sessions.findById(
      context.sessionId,
    );
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== user.id
    ) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessDenied,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.sessionInvalid,
        correlationId: cid,
      });
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, cid);
    }

    const authorization = await this.support.authorizeWorkspace(
      repositories,
      user,
      cid,
    );

    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.workspaceAccessAllowed,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: cid,
    });

    return {
      ok: true,
      user_id: user.id,
      display_name: user.displayName ?? user.email.toString(),
      role: authorization.role,
      session_expires_at: new Date(session.expiresAt).toISOString(),
      mfa_verified: session.isMfaVerified(),
      correlationId: cid,
    };
  }
}
