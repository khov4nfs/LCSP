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
  findByUserId(userId: string): Promise<MfaEnrollment | null>;
  save(enrollment: MfaEnrollment): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
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
  isUsed(userId: string, otpCode: string): Promise<boolean>;
  tryMarkUsed(userId: string, otpCode: string): Promise<boolean>;
  deleteByUserId(userId: string): Promise<void>;
  pruneOlderThan(cutoffMs: number): Promise<void>;
}

export interface MfaRecoveryCodeCreateInput {
  id: string;
  codeHash: string;
}

export interface MfaRecoveryCodeRepository {
  nextId(): string;
  nextBatchId(): string;
  hasActiveForUser(userId: string): Promise<boolean>;
  replaceForUser(
    userId: string,
    codes: readonly MfaRecoveryCodeCreateInput[],
    batchId: string,
    now: number,
  ): Promise<void>;
  revokeActiveForUser(userId: string, now: number): Promise<void>;
  tryConsume(userId: string, codeHash: string, now: number): Promise<boolean>;
}
