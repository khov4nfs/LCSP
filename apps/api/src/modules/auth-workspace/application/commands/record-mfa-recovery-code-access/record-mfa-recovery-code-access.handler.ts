import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
  createProblemResult,
} from "@lcsp/contracts/auth";

import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { RecordMfaRecoveryCodeAccessSuccess } from "../../contracts/auth-workspace/mfa.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { RecordMfaRecoveryCodeAccessCommand } from "./record-mfa-recovery-code-access.command.ts";

const RECOVERY_CODE_ACCESS_EVENTS = {
  [MFA_RECOVERY_CODE_ACCESS_ACTIONS.view]:
    AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeViewed,
  [MFA_RECOVERY_CODE_ACCESS_ACTIONS.download]:
    AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeDownloaded,
  [MFA_RECOVERY_CODE_ACCESS_ACTIONS.print]:
    AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodePrinted,
  [MFA_RECOVERY_CODE_ACCESS_ACTIONS.copy]:
    AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeCopied,
} as const;

export class RecordMfaRecoveryCodeAccessHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: RecordMfaRecoveryCodeAccessCommand,
  ): Promise<AuthProblemResult | RecordMfaRecoveryCodeAccessSuccess> {
    const { sessionToken, action, requestMeta } = command;
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

    const eventType = RECOVERY_CODE_ACCESS_EVENTS[action];
    if (!eventType) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    await this.support.recordAudit(this.repositories, {
      event_type: eventType,
      actor_id: session.userId,
      organization_id: session.organizationId,
      resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
      resource_id: session.userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
      action,
    });

    return { ok: true, correlationId: correlationId };
  }
}
