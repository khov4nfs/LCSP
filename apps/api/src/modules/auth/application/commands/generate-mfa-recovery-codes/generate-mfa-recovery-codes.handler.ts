import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
} from "../../security/mfa-recovery-code.utils.ts";
import type { GenerateMfaRecoveryCodesSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_RECOVERY_CODE_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  type MfaEnrollmentRepository,
  type MfaRecoveryCodeRepository,
  type SessionRepository,
} from "../../ports/persistence/index.ts";
import {
  AUTH_MFA_LIFECYCLE_PERSISTENCE,
  type MfaLifecyclePersistence,
} from "../../ports/persistence/mfa-lifecycle.persistence.ts";
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
    @Inject(AUTH_MFA_LIFECYCLE_PERSISTENCE)
    private readonly lifecycle: MfaLifecyclePersistence,
  ) {}

  /**
   * Business purpose: Issue a replacement set of backup credentials for the current MFA generation.
   *
   * Business rules:
   * - Only a session verified for the active, confirmed MFA generation may replace backup codes.
   * - Replacing a batch permanently revokes all unused credentials from the preceding batch.
   *
   * Execution flow:
   * 1. Verify the authenticated session and the active enrollment generation.
   * 2. Generate unique backup codes and commit their hashes under the user lock.
   * 3. Return only the cleartext codes belonging to the successfully committed batch.
   *
   * Failure cases:
   * - Missing generation proof or a concurrent factor rotation fails with MFA_REQUIRED.
   * - A failed transaction cannot expose credentials that were never committed.
   *
   * Side effects:
   * - Revokes the old batch, persists the new batch and records generation/view audit events.
   */
  async execute(
    command: GenerateMfaRecoveryCodesCommand,
  ): Promise<GenerateMfaRecoveryCodesSuccess> {
    const { userId, sessionId, requestMeta } = command;
    const { sessions, mfaEnrollments, mfaRecoveryCodes } = this;
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

    const enrollment = await mfaEnrollments.findByUserId(userId);
    if (
      !enrollment?.mfaGenerationId ||
      !enrollment.verifiedAt ||
      !session.isMfaVerified(enrollment.mfaGenerationId)
    ) {
      throw authFailure(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const now = this.support.now();
    const recoveryCodes = generateMfaRecoveryCodes();
    const batchId = mfaRecoveryCodes.nextBatchId();
    const result = await this.lifecycle.replaceRecoveryCodes({
      userId,
      sessionId,
      now,
      correlationId,
      expectedEncryptedSecret: enrollment.encryptedSecret,
      batchId,
      codes: recoveryCodes.map((code) => ({
        id: mfaRecoveryCodes.nextId(),
        codeHash: hashMfaRecoveryCode(code),
      })),
    });
    if (!result.ok) {
      throw authFailure(result.code, correlationId);
    }

    return {
      ok: true,
      correlationId: correlationId,
      recovery_codes: recoveryCodes,
    };
  }
}
