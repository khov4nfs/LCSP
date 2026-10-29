import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";
import { Inject, Logger } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import { verifyTotpOtp } from "../../../../../platform/security/totp.utils.js";
import {
  AUTH_MFA_SECRET_CIPHER,
  type MfaSecretCipher,
} from "../../ports/security/mfa-secret-cipher.port.ts";
import type { VerifyMfaOtpSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_OTP_USED_REPOSITORY,
  AUTH_MFA_RATE_LIMIT_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type MfaOtpUsedRepository,
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
import { VerifyMfaOtpCommand } from "./verify-mfa-otp.command.ts";

const MFA_RATE_LIMIT = 5;
const MFA_LOCK_WINDOW_MS = 15 * 60_000;

/**
 * Handles verifying TOTP time-based one-time password (OTP) during sign-in elevation.
 *
 * Enforces:
 * 1. Active, unexpired session lookup by fingerprint.
 * 2. Rate limiting (locks out after 5 consecutive failed attempts for 15 minutes).
 * 3. Single-use replay protection via atomic consumption in `mfaOtpUsed`.
 * 4. Decrypts AES-256-GCM TOTP secret and validates OTP with clock-skew tolerance (±1 step).
 * 5. Elevates session status (`mfaVerifiedAt`, `sensitiveActionVerifiedAt`).
 * 6. Emits audit trail events for successes and failures.
 */
@CommandHandler(VerifyMfaOtpCommand)
export class VerifyMfaOtpHandler implements ICommandHandler<VerifyMfaOtpCommand> {
  private readonly logger = new Logger(VerifyMfaOtpHandler.name);

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
    @Inject(AUTH_MFA_OTP_USED_REPOSITORY)
    private readonly mfaOtpUsed: MfaOtpUsedRepository,
    @Inject(AUTH_MFA_SECRET_CIPHER)
    private readonly cipher: MfaSecretCipher,
    @Inject(AUTH_MFA_LIFECYCLE_PERSISTENCE)
    private readonly lifecycle: MfaLifecyclePersistence,
  ) {}

  /**
   * Business purpose: Verify time-based one-time password (OTP) and elevate the session to MFA-verified.
   *
   * Business rules:
   * - Session must be active and unexpired.
   * - Must not exceed failed attempt rate limits (5 attempts per 15 minutes).
   * - TOTP secret must be decryptable and OTP must match with clock skew tolerance (+/- 1 step).
   * - Replayed OTPs within the replay protection window must be rejected.
   * - On success, elevates session MFA status and records audit atomically.
   *
   * Execution flow:
   * 1. Validate session and rate limit status.
   * 2. Decrypt secret; if undecryptable, reject with retryRecovery required action.
   * 3. Verify OTP against current time; check replay protection.
   * 4. Atomically commit proof, session elevation, and audit via lifecycle persistence.
   *
   * Failure cases:
   * - Invalid session, rate-limited lockout, undecryptable secret, or wrong OTP rejects elevation and increments failure counters.
   *
   * Side effects:
   * - Consumes OTP token, elevates session, records security audit events.
   */
  async execute(command: VerifyMfaOtpCommand): Promise<VerifyMfaOtpSuccess> {
    const { sessionToken, otp, requestMeta } = command;
    const { sessions, users, mfaEnrollments, mfaRateLimits, mfaOtpUsed } = this;
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
    const candidate = session.candidateMfaEnrollment;
    const targetEncryptedSecret =
      candidate?.encryptedSecret ?? enrollment?.encryptedSecret;
    if (!targetEncryptedSecret) {
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

    const alreadyUsed = await mfaOtpUsed.isUsed(session.userId, otp);
    if (alreadyUsed) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "replayed",
      );
      throw authFailure(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    let plaintextSecret: string;
    try {
      plaintextSecret = this.cipher.decrypt(targetEncryptedSecret);
    } catch {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "decrypt_error",
      );
      throw authFailure(AUTH_ERROR_CODES.mfaInvalid, correlationId, {
        requiredAction: REQUIRED_ACTIONS.retryRecovery,
      });
    }

    const valid = verifyTotpOtp(plaintextSecret, otp, now);
    if (!valid) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "invalid",
      );
      throw authFailure(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    const proofResult = await this.lifecycle.verifyProof({
      userId: session.userId,
      sessionId: session.id,
      expectedEncryptedSecret: targetEncryptedSecret,
      now,
      correlationId,
      proof: { kind: MFA_PROOF_TYPES.otp, otp },
      candidate,
    });
    if (!proofResult.ok) {
      if (proofResult.code === AUTH_ERROR_CODES.mfaInvalid) {
        await this.recordFailedAttempt(
          session.userId,
          now,
          correlationId,
          "replayed",
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
      MFA_RATE_LIMIT,
      MFA_LOCK_WINDOW_MS,
    );

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaFailed,
      actor_id: userId,
      decision: AUDIT_DECISIONS.deny,
      reason_code: AUTH_ERROR_CODES.mfaInvalid,
      otp_failure_reason: reason,
      correlationId: correlationId,
    });

    this.logger.warn(
      `MFA OTP verify failed userId=${userId} reason=${reason} correlationId=${correlationId}`,
    );
  }
}
