import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import type { RecordMfaRecoveryCodeAccessSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type SessionRepository,
  type UserRepository,
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
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  /**
   * Business purpose: Audit customer access to currently valid MFA recovery credentials.
   *
   * Business rules:
   * - Viewing, downloading, printing or copying codes requires current-generation MFA verification.
   * - A rotated or disabled factor invalidates previously issued session proofs.
   *
   * Execution flow:
   * 1. Validate the account's session, confirmed MFA enrollment and current proof generation.
   * 2. Resolve the approved recovery-code access action to an audit event.
   * 3. Persist the security audit observation without exposing recovery code values.
   *
   * Failure cases:
   * - Inactive sessions and stale MFA proofs are rejected without recording successful access.
   * - Invalid action values use the shared validation failure response.
   *
   * Side effects:
   * - Writes one sanitized MFA recovery-code access audit event.
   */
  async execute(
    command: RecordMfaRecoveryCodeAccessCommand,
  ): Promise<RecordMfaRecoveryCodeAccessSuccess> {
    const { userId, action, sessionId, requestMeta } = command;
    const { sessions } = this;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw authFailure(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const session = await sessions.findById(sessionId);
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== userId
    ) {
      throw authFailure(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const user = await this.users.findById(userId);
    if (
      !user ||
      user.mfaVerifiedAt === null ||
      !session.isMfaVerified(user.mfaGenerationId)
    ) {
      throw authFailure(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const eventType = RECOVERY_CODE_ACCESS_EVENTS[action];
    if (!eventType) {
      throw authFailure(AUTH_ERROR_CODES.validationFailed, correlationId);
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
