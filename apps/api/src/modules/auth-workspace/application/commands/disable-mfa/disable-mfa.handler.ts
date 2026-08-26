import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { DisableMfaSuccess } from "../../contracts/auth-workspace/mfa.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { DisableMfaCommand } from "./disable-mfa.command.ts";

export class DisableMfaHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: DisableMfaCommand,
  ): Promise<AuthProblemResult | DisableMfaSuccess> {
    const { sessionToken, requestMeta } = command;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const session = await this.support.findValidSession(
      this.repositories,
      sessionToken,
    );
    if (!session) {
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    if (!session.isMfaVerified()) {
      return createProblemResult(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const enrollment = await this.repositories.mfaEnrollments.findByUserId(
      session.userId,
    );
    if (!enrollment) {
      return { ok: true, correlationId: correlationId };
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

    const now = this.support.now();
    await this.repositories.mfaEnrollments.deleteByUserId(session.userId);
    await this.repositories.mfaRecoveryCodes.revokeActiveForUser(
      session.userId,
      now,
    );
    user.mfaRequired = false;
    await this.repositories.users.save(user);
    session.mfaVerifiedAt = null;
    await this.repositories.sessions.save(session);

    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaDisabled,
      actor_id: session.userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
    });

    return { ok: true, correlationId: correlationId };
  }
}
