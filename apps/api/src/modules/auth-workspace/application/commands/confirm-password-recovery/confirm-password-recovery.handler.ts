import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import {
  fingerprintToken,
  hashSecret,
} from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { ConfirmRecoverySuccess } from "../../contracts/auth-workspace/recovery.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { ConfirmPasswordRecoveryCommand } from "./confirm-password-recovery.command.ts";

export class ConfirmPasswordRecoveryHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: ConfirmPasswordRecoveryCommand,
  ): Promise<AuthProblemResult | ConfirmRecoverySuccess> {
    const { payload, requestMeta } = command;
    const { repositories } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    if (
      typeof payload.token !== "string" ||
      payload.token.trim().length === 0 ||
      typeof payload.new_password !== "string" ||
      payload.new_password.length === 0
    ) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    const now = this.support.now();
    const recoveryRequest =
      await repositories.recoveryRequests.findByFingerprint(
        fingerprintToken(payload.token),
      );
    if (!recoveryRequest || !recoveryRequest.isValid(now)) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryConfirmFailed,
        actor_id: recoveryRequest?.userId ?? null,
        organization_id: null,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.recoveryInvalid,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.recoveryInvalid,
        correlationId,
      );
    }

    const user = await repositories.users.findById(recoveryRequest.userId);
    if (!user) {
      return createProblemResult(
        AUTH_ERROR_CODES.recoveryInvalid,
        correlationId,
      );
    }

    user.passwordHash = hashSecret(payload.new_password);
    user.clearFailedLogins();
    await repositories.users.save(user);

    recoveryRequest.consume(now);
    await repositories.recoveryRequests.save(recoveryRequest);

    await repositories.sessions.revokeAllForUser(user.id, now);

    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryConfirmed,
      actor_id: user.id,
      organization_id: null,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    return { ok: true, correlationId: correlationId };
  }
}
