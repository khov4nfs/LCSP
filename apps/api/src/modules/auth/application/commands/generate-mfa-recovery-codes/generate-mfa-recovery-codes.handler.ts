import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
} from "../../../infrastructure/security/mfa-recovery-code.utils.ts";
import type { GenerateMfaRecoveryCodesSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_RECOVERY_CODE_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  type MfaEnrollmentRepository,
  type MfaRecoveryCodeRepository,
  type SessionRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { GenerateMfaRecoveryCodesCommand } from "./generate-mfa-recovery-codes.command.ts";

/**
 * Handles generating a new batch of MFA backup recovery codes for an enrolled user.
 *
 * Enforces:
 * 1. Active, unexpired session belonging to the acting user.
 * 2. Session has verified MFA status (step-up verified).
 * 3. Active MFA enrollment exists for the user.
 * 4. Atomically replaces any existing recovery codes with the newly generated batch.
 * 5. Emits audit events for code generation and initial view.
 */
@CommandHandler(GenerateMfaRecoveryCodesCommand)
export class GenerateMfaRecoveryCodesHandler implements ICommandHandler<GenerateMfaRecoveryCodesCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
    @Inject(AUTH_MFA_RECOVERY_CODE_REPOSITORY)
    private readonly mfaRecoveryCodes: MfaRecoveryCodeRepository,
  ) {}

  /**
   * Executes recovery codes generation.
   *
   * @param command - Contains userId, sessionId, and request correlation metadata.
   * @returns Generated plain recovery codes array and correlation ID.
   */
  async execute(
    command: GenerateMfaRecoveryCodesCommand,
  ): Promise<GenerateMfaRecoveryCodesSuccess> {
    const { userId, sessionId, requestMeta } = command;
    const { sessions, mfaEnrollments, mfaRecoveryCodes } = this;
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

    const enrollment = await mfaEnrollments.findByUserId(userId);
    if (!enrollment) {
      throw problemException(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const now = this.support.now();
    const recoveryCodes = generateMfaRecoveryCodes();
    const batchId = mfaRecoveryCodes.nextBatchId();
    await mfaRecoveryCodes.replaceForUser(
      userId,
      recoveryCodes.map((code) => ({
        id: mfaRecoveryCodes.nextId(),
        codeHash: hashMfaRecoveryCode(code),
      })),
      batchId,
      now,
    );

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodesGenerated,
      actor_id: userId,
      resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
      resource_id: batchId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: sessionId ?? null,
      batch_id: batchId,
      code_count: recoveryCodes.length,
    });
    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeViewed,
      actor_id: userId,
      resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
      resource_id: batchId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: sessionId ?? null,
      batch_id: batchId,
    });

    return {
      ok: true,
      correlationId: correlationId,
      recovery_codes: recoveryCodes,
    };
  }
}
