import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

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
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { EnrollMfaSuccess } from "../../contracts/auth-workspace/mfa.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { EnrollMfaCommand } from "./enroll-mfa.command.ts";

export class EnrollMfaHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: EnrollMfaCommand,
  ): Promise<AuthProblemResult | EnrollMfaSuccess> {
    const { sessionToken, requestMeta } = command;
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

    const existingEnrollment =
      await this.repositories.mfaEnrollments.findByUserId(session.userId);
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
        return createProblemResult(AUTH_ERROR_CODES.mfaRequired, correlationId);
      }
    }

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

    const now = this.support.now();
    const plainSecret = generateTotpSecret();
    const encryptedSecret = encryptMfaSecret(plainSecret);
    const enrollment = new MfaEnrollment({
      userId: session.userId,
      encryptedSecret,
      enrolledAt: now,
      verifiedAt: null,
    });
    await this.repositories.mfaEnrollments.save(enrollment);
    await this.repositories.mfaOtpUsed.deleteByUserId(session.userId);
    await this.repositories.mfaRateLimits.resetByUserId(session.userId);

    let recoveryCodes: string[] = [];
    const hasActiveRecoveryCodes =
      await this.repositories.mfaRecoveryCodes.hasActiveForUser(session.userId);
    if (!hasActiveRecoveryCodes) {
      recoveryCodes = generateMfaRecoveryCodes();
      const batchId = this.repositories.mfaRecoveryCodes.nextBatchId();
      await this.repositories.mfaRecoveryCodes.replaceForUser(
        session.userId,
        recoveryCodes.map((code) => ({
          id: this.repositories.mfaRecoveryCodes.nextId(),
          codeHash: hashMfaRecoveryCode(code),
        })),
        batchId,
        now,
      );

      await this.support.recordAudit(this.repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodesGenerated,
        actor_id: session.userId,
        organization_id: session.organizationId,
        resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
        resource_id: batchId,
        decision: AUDIT_DECISIONS.allow,
        correlationId: correlationId,
        session_id: session.id,
        batch_id: batchId,
        code_count: recoveryCodes.length,
      });
      await this.support.recordAudit(this.repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeViewed,
        actor_id: session.userId,
        organization_id: session.organizationId,
        resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
        resource_id: batchId,
        decision: AUDIT_DECISIONS.allow,
        correlationId: correlationId,
        session_id: session.id,
        batch_id: batchId,
      });
    }

    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled,
      actor_id: session.userId,
      organization_id: session.organizationId,
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
