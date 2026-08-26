import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";
import { Logger } from "@nestjs/common";

import { MfaRateLimit } from "../../../domain/entities/mfa-rate-limit.entity.ts";
import {
  decryptMfaSecret,
  verifyTotpOtp,
} from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { VerifyMfaOtpSuccess } from "../../contracts/auth-workspace/mfa.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { VerifyMfaOtpCommand } from "./verify-mfa-otp.command.ts";

const MFA_RATE_LIMIT = 5;
const MFA_LOCK_WINDOW_MS = 15 * 60_000;
// ±1 TOTP step (30s) plus clock-skew slack; anything older can never be replayed.
const OTP_USED_RETENTION_MS = 5 * 60_000;

export class VerifyMfaOtpHandler {
  private readonly logger = new Logger(VerifyMfaOtpHandler.name);

  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: VerifyMfaOtpCommand,
  ): Promise<AuthProblemResult | VerifyMfaOtpSuccess> {
    const { sessionToken, otp, requestMeta } = command;
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

    const enrollment = await this.repositories.mfaEnrollments.findByUserId(
      session.userId,
    );
    if (!enrollment) {
      return createProblemResult(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    const now = this.support.now();

    const rateLimit = await this.repositories.mfaRateLimits.findByUserId(
      session.userId,
    );
    if (rateLimit?.isLocked(now)) {
      await this.support.recordAudit(this.repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRateLimited,
        actor_id: session.userId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.mfaRateLimited,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.mfaRateLimited,
        correlationId,
      );
    }

    const alreadyUsed = await this.repositories.mfaOtpUsed.isUsed(
      session.userId,
      otp,
    );
    if (alreadyUsed) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "replayed",
      );
      return createProblemResult(AUTH_ERROR_CODES.mfaInvalid, correlationId);
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
      return createProblemResult(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const valid = verifyTotpOtp(plaintextSecret, otp, now);
    if (!valid) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "invalid",
      );
      return createProblemResult(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    const claimed = await this.repositories.mfaOtpUsed.tryMarkUsed(
      session.userId,
      otp,
    );
    if (!claimed) {
      // Lost a concurrent race to consume this exact code — treat as replay.
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "replayed",
      );
      return createProblemResult(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }
    await this.repositories.mfaOtpUsed.pruneOlderThan(
      now - OTP_USED_RETENTION_MS,
    );

    enrollment.verifiedAt = now;
    await this.repositories.mfaEnrollments.save(enrollment);
    session.markMfaVerified(now);
    session.markSensitiveActionVerified(now);
    await this.repositories.sessions.save(session);

    const user = await this.support.resolveUserById(
      this.repositories,
      session.userId,
    );
    if (!user) {
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }
    user.mfaRequired = true;
    await this.repositories.users.save(user);

    const existingRateLimit =
      rateLimit ?? new MfaRateLimit({ userId: session.userId });
    existingRateLimit.clearOnSuccess();
    await this.repositories.mfaRateLimits.save(existingRateLimit);

    await this.support.recordAudit(this.repositories, {
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
    await this.repositories.mfaRateLimits.recordFailedAttempt(
      userId,
      now,
      MFA_RATE_LIMIT,
      MFA_LOCK_WINDOW_MS,
    );

    await this.support.recordAudit(this.repositories, {
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
