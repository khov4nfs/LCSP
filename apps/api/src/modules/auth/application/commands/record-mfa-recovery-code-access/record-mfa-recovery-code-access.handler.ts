import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import type { RecordMfaRecoveryCodeAccessSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_SESSION_REPOSITORY,
  type SessionRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
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

/**
 * Handles recording audit telemetry whenever a user accesses their MFA recovery codes.
 *
 * Enforces:
 * 1. Active, unexpired session belonging to the user.
 * 2. MFA verified status on the session (step-up required).
 * 3. Maps access action (view, download, print, copy) to specific audit events.
 * 4. Records structured audit logs with actor ID and action metadata.
 */
@CommandHandler(RecordMfaRecoveryCodeAccessCommand)
export class RecordMfaRecoveryCodeAccessHandler implements ICommandHandler<RecordMfaRecoveryCodeAccessCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
  ) {}

  /**
   * Executes access telemetry recording for recovery codes.
   *
   * @param command - Contains userId, access action, sessionId, and request metadata.
   * @returns Success response with correlation ID.
   */
  async execute(
    command: RecordMfaRecoveryCodeAccessCommand,
  ): Promise<RecordMfaRecoveryCodeAccessSuccess> {
    const { userId, action, sessionId, requestMeta } = command;
    const { sessions } = this;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const session = await sessions.findById(sessionId);
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== userId
    ) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    if (!session.isMfaVerified()) {
      throw problemException(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const eventType = RECOVERY_CODE_ACCESS_EVENTS[action];
    if (!eventType) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    await this.support.recordAudit({
      event_type: eventType,
      actor_id: userId,
      resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
      resource_id: userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: sessionId,
      action,
    });

    return { ok: true, correlationId: correlationId };
  }
}
