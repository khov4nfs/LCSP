import { AUTH_ERROR_CODES, USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import { MfaEnrollment } from "../../../domain/entities/mfa-enrollment.entity.ts";
import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
} from "../../security/mfa-recovery-code.utils.ts";
import { generateTotpSecret } from "../../../../../platform/security/totp.utils.js";
import {
  AUTH_MFA_SECRET_CIPHER,
  type MfaSecretCipher,
} from "../../ports/security/mfa-secret-cipher.port.ts";
import type { EnrollMfaSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_RECOVERY_CODE_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type MfaRecoveryCodeRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import {
  AUTH_MFA_LIFECYCLE_PERSISTENCE,
  type MfaLifecyclePersistence,
} from "../../ports/persistence/mfa-lifecycle.persistence.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { EnrollMfaCommand } from "./enroll-mfa.command.ts";

/**
 * Handles initiating TOTP multi-factor authentication (MFA) enrollment.
 *
 * Enforces:
 * 1. Active session belonging to the user.
 * 2. Unverified session cannot silently overwrite existing valid MFA secrets.
 * 3. Generates new base32 TOTP secret, encrypts it with AES-256-GCM.
 * 4. Resets OTP rate limits and used OTP history.
 * 5. Always rotates the recovery-code batch and invalidates all session proofs atomically.
 * 6. Emits audit events and returns `otpauth://` URI.
 */
@CommandHandler(EnrollMfaCommand)
export class EnrollMfaHandler implements ICommandHandler<EnrollMfaCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
    @Inject(AUTH_MFA_RECOVERY_CODE_REPOSITORY)
    private readonly mfaRecoveryCodes: MfaRecoveryCodeRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_MFA_SECRET_CIPHER)
    private readonly cipher: MfaSecretCipher,
    @Inject(AUTH_MFA_LIFECYCLE_PERSISTENCE)
    private readonly lifecycle: MfaLifecyclePersistence,
  ) {}

  /**
   * Business purpose: Start a fresh TOTP enrollment or securely rotate a proven existing factor.
   *
   * Business rules:
   * - An existing factor can be replaced only by a proof for its current MFA generation.
   * - Every new secret revokes old backup codes and invalidates all session step-up proofs atomically.
   * - A password-only session cannot recover ciphertext that has become undecryptable.
   *
   * Execution flow:
   * 1. Validate the owning active session and existing MFA proof generation.
   * 2. Create an encrypted TOTP secret and one candidate recovery-code batch.
   * 3. Commit the new generation, code replacement, session invalidation and audit in one transaction.
   * 4. Return the TOTP URI and only the recovery codes actually committed.
   *
   * Failure cases:
   * - Missing, stale or unverified session proof rejects MFA replacement without changing credentials.
   * - Transactional audit or persistence failure rolls back secret, code and proof changes together.
   *
   * Side effects:
   * - Rotates MFA credentials, clears all session proof metadata and writes audit events.
   */
  async execute(command: EnrollMfaCommand): Promise<EnrollMfaSuccess> {
    const { userId, sessionId, requestMeta } = command;
    const { sessions, mfaEnrollments, mfaRecoveryCodes, users } = this;
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

    const user = await users.findById(userId);
    if (!user) {
      throw authFailure(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }
    if (user.accessStatus !== USER_ACCESS_STATUSES.active) {
      throw authFailure(AUTH_ERROR_CODES.accountSuspended, correlationId);
    }

    const existingEnrollment = await mfaEnrollments.findByUserId(userId);
    // A password-only session must never rotate the factor. If ciphertext
    // cannot be decrypted, recovery needs a separately authorized support
    // flow; it is not equivalent to MFA proof.
    if (existingEnrollment && !session.isMfaVerified(user.mfaGenerationId)) {
      throw authFailure(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const now = this.support.now();
    const plainSecret = generateTotpSecret();
    const encryptedSecret = this.cipher.encrypt(plainSecret);
    const enrollment = new MfaEnrollment({
      userId: userId,
      encryptedSecret,
      enrolledAt: now,
      verifiedAt: null,
    });
    // Precompute opaque codes before acquiring the user row lock. Only return
    // codes if the same transaction actually persisted the candidate batch.
    const candidateCodes = generateMfaRecoveryCodes();
    const result = await this.lifecycle.enroll({
      userId,
      sessionId,
      now,
      correlationId,
      enrollment,
      expectedEncryptedSecret: existingEnrollment?.encryptedSecret ?? null,
      candidateBatchId: mfaRecoveryCodes.nextBatchId(),
      candidateCodes: candidateCodes.map((code) => ({
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
      totp_uri: buildTotpUri(plainSecret, user.primaryEmailAddress()),
      recovery_codes: result.recoveryCodesCreated ? candidateCodes : [],
    };
  }
}

function buildTotpUri(secret: string, accountName: string): string {
  const issuer = "LCSP";
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
