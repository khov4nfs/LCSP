import type {
  MfaEnrollment,
  MfaRateLimit,
} from "../../../domain/models/auth.models.ts";

export const AUTH_MFA_ENROLLMENT_REPOSITORY = Symbol(
  "AUTH_MFA_ENROLLMENT_REPOSITORY",
);
export const AUTH_MFA_RATE_LIMIT_REPOSITORY = Symbol(
  "AUTH_MFA_RATE_LIMIT_REPOSITORY",
);
export const AUTH_MFA_OTP_USED_REPOSITORY = Symbol(
  "AUTH_MFA_OTP_USED_REPOSITORY",
);
export const AUTH_MFA_RECOVERY_CODE_REPOSITORY = Symbol(
  "AUTH_MFA_RECOVERY_CODE_REPOSITORY",
);

export interface MfaEnrollmentRepository {
  /** Read-only access: enrollment mutations are exclusive to the locked MFA lifecycle port. */
  findByUserId(userId: string): Promise<MfaEnrollment | null>;
}

export interface MfaRateLimitRepository {
  findByUserId(userId: string): Promise<MfaRateLimit | null>;
  save(rateLimit: MfaRateLimit): Promise<void>;
  resetByUserId(userId: string): Promise<void>;
  recordFailedAttempt(
    userId: string,
    now: number,
    limit: number,
    lockWindowMs: number,
  ): Promise<MfaRateLimit>;
}

export interface MfaOtpUsedRepository {
  /** Preliminary replay probe; transactional MFA proof consumption is the authority. */
  isUsed(userId: string, otpCode: string): Promise<boolean>;
}

export interface MfaRecoveryCodeCreateInput {
  id: string;
  codeHash: string;
}

export interface MfaRecoveryCodeRepository {
  /** ID allocation only: code replacement, revocation and consumption are transactional. */
  nextId(): string;
  nextBatchId(): string;
}
