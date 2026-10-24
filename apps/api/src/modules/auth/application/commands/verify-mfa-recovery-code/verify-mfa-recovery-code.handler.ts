import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { Inject, Logger } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import {
  hashMfaRecoveryCode,
  normalizeMfaRecoveryCode,
} from "../../security/mfa-recovery-code.utils.ts";
import type { VerifyMfaRecoveryCodeSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_RATE_LIMIT_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type MfaRateLimitRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import {
  AUTH_MFA_LIFECYCLE_PERSISTENCE,
  MFA_PROOF_TYPES,
  type MfaLifecyclePersistence,
} from "../../ports/persistence/mfa-lifecycle.persistence.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { VerifyMfaRecoveryCodeCommand } from "./verify-mfa-recovery-code.command.ts";

const MFA_RECOVERY_RATE_LIMIT = 5;
const MFA_RECOVERY_LOCK_WINDOW_MS = 15 * 60_000;

/**
 * Handles verifying a backup MFA recovery code during sign-in elevation.
 *
 * Enforces:
 * 1. Active, unexpired session lookup by fingerprint.
 * 2. Rate limiting (locks out after 5 consecutive failed attempts for 15 minutes).
 * 3. Normalized alphanumeric recovery code matching against SHA-256 hash.
 * 4. Atomic single-use consumption in repository (`tryConsume`).
 * 5. Elevates session status (`mfaVerifiedAt`, `sensitiveActionVerifiedAt`).
 * 6. Emits audit trail events for successes and failures.
 */
@CommandHandler(VerifyMfaRecoveryCodeCommand)
export class VerifyMfaRecoveryCodeHandler implements ICommandHandler<VerifyMfaRecoveryCodeCommand> {
  private readonly logger = new Logger(VerifyMfaRecoveryCodeHandler.name);

  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
    @Inject(AUTH_MFA_RATE_LIMIT_REPOSITORY)
    private readonly mfaRateLimits: MfaRateLimitRepository,
    @Inject(AUTH_MFA_LIFECYCLE_PERSISTENCE)
    private readonly lifecycle: MfaLifecyclePersistence,
  ) {}

  /**
   * Executes MFA recovery code verification.
   *
   * @param command - Contains sessionToken, recovery code string, and request correlation metadata.
   * @returns Success response with correlation ID.
   */
  async execute(
    command: VerifyMfaRecoveryCodeCommand,
  ): Promise<VerifyMfaRecoveryCodeSuccess> {
    const { sessionToken, code, requestMeta } = command;
    const { sessions, users, mfaEnrollments, mfaRateLimits } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const session = await this.support.findValidSession(
      sessions,
      users,
      sessionToken,
    );
    if (!session) {
      throw authFailure(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const enrollment = await mfaEnrollments.findByUserId(session.userId);
    if (!enrollment) {
      throw authFailure(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    const now = this.support.now();
    const rateLimit = await mfaRateLimits.findByUserId(session.userId);
    if (rateLimit?.isLocked(now)) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRateLimited,
        actor_id: session.userId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.mfaRateLimited,
        correlationId: correlationId,
      });
      throw authFailure(AUTH_ERROR_CODES.mfaRateLimited, correlationId);
    }

    const normalizedCode = normalizeMfaRecoveryCode(code);
    if (normalizedCode.length === 0) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "empty",
      );
      throw authFailure(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    const proofResult = await this.lifecycle.verifyProof({
      userId: session.userId,
      sessionId: session.id,
      expectedEncryptedSecret: enrollment.encryptedSecret,
      now,
      correlationId,
      proof: {
        kind: MFA_PROOF_TYPES.recoveryCode,
        codeHash: hashMfaRecoveryCode(normalizedCode),
      },
    });
    if (!proofResult.ok) {
      if (proofResult.code === AUTH_ERROR_CODES.mfaInvalid) {
        await this.recordFailedAttempt(
          session.userId,
          now,
          correlationId,
          "invalid_or_used",
        );
      }
      throw authFailure(proofResult.code, correlationId);
    }

    return { ok: true, correlationId: correlationId };
  }

  private async recordFailedAttempt(
    userId: string,
    now: number,
    correlationId: string,
    reason: string,
  ): Promise<void> {
    await this.mfaRateLimits.recordFailedAttempt(
      userId,
      now,
      MFA_RECOVERY_RATE_LIMIT,
      MFA_RECOVERY_LOCK_WINDOW_MS,
    );

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaFailed,
      actor_id: userId,
      decision: AUDIT_DECISIONS.deny,
      reason_code: AUTH_ERROR_CODES.mfaInvalid,
      recovery_code_failure_reason: reason,
      correlationId: correlationId,
    });

    this.logger.warn(
      `MFA recovery code verify failed userId=${userId} reason=${reason} correlationId=${correlationId}`,
    );
  }
}
