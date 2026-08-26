import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";
import { Logger } from "@nestjs/common";

import { MfaRateLimit } from "../../../domain/entities/mfa-rate-limit.entity.ts";
import {
  hashMfaRecoveryCode,
  normalizeMfaRecoveryCode,
} from "../../../infrastructure/security/mfa-recovery-code.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { VerifyMfaRecoveryCodeSuccess } from "../../contracts/auth-workspace/mfa.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { VerifyMfaRecoveryCodeCommand } from "./verify-mfa-recovery-code.command.ts";

const MFA_RECOVERY_RATE_LIMIT = 5;
const MFA_RECOVERY_LOCK_WINDOW_MS = 15 * 60_000;

export class VerifyMfaRecoveryCodeHandler {
  private readonly logger = new Logger(VerifyMfaRecoveryCodeHandler.name);

  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: VerifyMfaRecoveryCodeCommand,
  ): Promise<AuthProblemResult | VerifyMfaRecoveryCodeSuccess> {
    const { sessionToken, code, requestMeta } = command;
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

    const normalizedCode = normalizeMfaRecoveryCode(code);
    if (normalizedCode.length === 0) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "empty",
      );
      return createProblemResult(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

    const consumed = await this.repositories.mfaRecoveryCodes.tryConsume(
      session.userId,
      hashMfaRecoveryCode(normalizedCode),
      now,
    );
    if (!consumed) {
      await this.recordFailedAttempt(
        session.userId,
        now,
        correlationId,
        "invalid_or_used",
      );
      return createProblemResult(AUTH_ERROR_CODES.mfaInvalid, correlationId);
    }

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
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeUsed,
      actor_id: session.userId,
      resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
      resource_id: session.userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
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
      MFA_RECOVERY_RATE_LIMIT,
      MFA_RECOVERY_LOCK_WINDOW_MS,
    );

    await this.support.recordAudit(this.repositories, {
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
