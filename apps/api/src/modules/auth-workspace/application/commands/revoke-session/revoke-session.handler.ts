import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { AUTH_LEGACY_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";

import { fingerprintToken } from "../../../infrastructure/security/security.utils.ts";
import type { RevokeSessionSuccess } from "../../contracts/auth-workspace/revoke-session.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { RevokeSessionCommand } from "./revoke-session.command.ts";

export class RevokeSessionHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(command: RevokeSessionCommand): Promise<RevokeSessionSuccess> {
    const { sessionToken, requestMeta } = command;
    const { repositories } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();
    const session = await repositories.sessions.findByFingerprint(
      fingerprintToken(sessionToken),
    );
    if (session) {
      session.revoke(this.support.now());
      await repositories.sessions.save(session);
    }
    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.sessionRevoked,
      actor_id: session?.userId ?? null,
      organization_id: session?.organizationId ?? null,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });
    return { ok: true, correlationId: correlationId };
  }
}
