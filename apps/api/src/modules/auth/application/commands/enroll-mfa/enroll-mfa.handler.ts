import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { MfaEnrollment } from "../../../domain/entities/mfa-enrollment.entity.ts";
import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
} from "../../../infrastructure/security/mfa-recovery-code.utils.ts";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateTotpSecret,
} from "../../../infrastructure/security/security.utils.ts";
import type { EnrollMfaSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_OTP_USED_REPOSITORY,
  AUTH_MFA_RATE_LIMIT_REPOSITORY,
  AUTH_MFA_RECOVERY_CODE_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type MfaOtpUsedRepository,
  type MfaRateLimitRepository,
  type MfaRecoveryCodeRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { EnrollMfaCommand } from "./enroll-mfa.command.ts";

@CommandHandler(EnrollMfaCommand)
export class EnrollMfaHandler implements ICommandHandler<EnrollMfaCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
    @Inject(AUTH_MFA_OTP_USED_REPOSITORY)
    private readonly mfaOtpUsed: MfaOtpUsedRepository,
    @Inject(AUTH_MFA_RATE_LIMIT_REPOSITORY)
    private readonly mfaRateLimits: MfaRateLimitRepository,
    @Inject(AUTH_MFA_RECOVERY_CODE_REPOSITORY)
    private readonly mfaRecoveryCodes: MfaRecoveryCodeRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  async execute(command: EnrollMfaCommand): Promise<EnrollMfaSuccess> {
    const { userId, sessionId, requestMeta } = command;
    const {
      sessions,
      mfaEnrollments,
      mfaOtpUsed,
      mfaRateLimits,
      mfaRecoveryCodes,
      users,
    } = this;
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

    const existingEnrollment = await mfaEnrollments.findByUserId(userId);
    if (existingEnrollment && !session.isMfaVerified()) {
      let hasRecoverableSecretFailure = false;
      try {
        decryptMfaSecret(existingEnrollment.encryptedSecret);
      } catch {
        // A stale ciphertext encrypted under an old key cannot be verified.
        // Allow issuing a replacement enrollment so the user can recover MFA.
        hasRecoverableSecretFailure = true;
      }

      if (!hasRecoverableSecretFailure) {
        // A valid-but-unverified session must not be able to silently replace
        // an existing TOTP secret (would let a stolen pre-MFA session hijack MFA).
        throw problemException(AUTH_ERROR_CODES.mfaRequired, correlationId);
      }
    }

    const user = await users.findById(userId);
    if (!user) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const now = this.support.now();
    const plainSecret = generateTotpSecret();
    const encryptedSecret = encryptMfaSecret(plainSecret);
    const enrollment = new MfaEnrollment({
      userId: userId,
      encryptedSecret,
      enrolledAt: now,
      verifiedAt: null,
    });
    await mfaEnrollments.save(enrollment);
    await mfaOtpUsed.deleteByUserId(userId);
    await mfaRateLimits.resetByUserId(userId);

    let recoveryCodes: string[] = [];
    const hasActiveRecoveryCodes =
      await mfaRecoveryCodes.hasActiveForUser(userId);
    if (!hasActiveRecoveryCodes) {
      recoveryCodes = generateMfaRecoveryCodes();
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
    }

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled,
      actor_id: userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    return {
      ok: true,
      correlationId: correlationId,
      totp_uri: buildTotpUri(plainSecret, user.primaryEmailAddress()),
      recovery_codes: recoveryCodes,
    };
  }
}

function buildTotpUri(secret: string, accountName: string): string {
  const issuer = "LCSP";
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
