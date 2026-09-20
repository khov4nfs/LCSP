import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { Inject, Logger } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { MfaRateLimit } from "../../../domain/entities/mfa-rate-limit.entity.ts";
import {
  decryptMfaSecret,
  verifyTotpOtp,
} from "../../../infrastructure/security/security.utils.ts";
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
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { VerifyMfaOtpCommand } from "./verify-mfa-otp.command.ts";

const MFA_RATE_LIMIT = 5;
const MFA_LOCK_WINDOW_MS = 15 * 60_000;
// ±1 TOTP step (30s) plus clock-skew slack; anything older can never be replayed.
const OTP_USED_RETENTION_MS = 5 * 60_000;

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
  ) {}

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
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const enrollment = await mfaEnrollments.findByUserId(session.userId);
    if (!enrollment) {
      throw problemException(AUTH_ERROR_CODES.mfaInvalid, correlationId);
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
      throw problemException(AUTH_ERROR_CODES.mfaRateLimited, correlationId);
    }

    const alreadyUsed = await mfaOtpUsed.isUsed(session.userId, otp);
    if (alreadyUsed) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "replayed",
      );
      throw problemException(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    let plaintextSecret: string;
    try {
      plaintextSecret = decryptMfaSecret(enrollment.encryptedSecret);
    } catch {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "decrypt_error",
      );
      throw problemException(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const valid = verifyTotpOtp(plaintextSecret, otp, now);
    if (!valid) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "invalid",
      );
      throw problemException(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    const claimed = await mfaOtpUsed.tryMarkUsed(session.userId, otp);
    if (!claimed) {
      // Lost a concurrent race to consume this exact code — treat as replay.
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "replayed",
      );
      throw problemException(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }
    await mfaOtpUsed.pruneOlderThan(now - OTP_USED_RETENTION_MS);

    enrollment.verifiedAt = now;
    await mfaEnrollments.save(enrollment);
    session.markMfaVerified(now);
    session.markSensitiveActionVerified(now);
    await sessions.save(session);

    const user = await users.findById(session.userId);
    if (!user) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }
    user.mfaRequired = true;
    await users.save(user);

    const existingRateLimit =
      rateLimit ?? new MfaRateLimit({ userId: session.userId });
    existingRateLimit.clearOnSuccess();
    await mfaRateLimits.save(existingRateLimit);

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaVerified,
      actor_id: session.userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

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
