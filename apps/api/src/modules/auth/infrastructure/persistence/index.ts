import {
  AUTH_AUDIT_EVENT_REPOSITORY,
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_OTP_USED_REPOSITORY,
  AUTH_MFA_RATE_LIMIT_REPOSITORY,
  AUTH_MFA_RECOVERY_CODE_REPOSITORY,
  AUTH_OAUTH_IDENTITY_REPOSITORY,
  AUTH_OAUTH_STATE_REPOSITORY,
  AUTH_RECOVERY_REQUEST_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
} from "../../application/ports/persistence/index.ts";
import {
  PrismaAuditEventRepository,
  PrismaMfaEnrollmentRepository,
  PrismaMfaOtpUsedRepository,
  PrismaMfaRateLimitRepository,
  PrismaMfaRecoveryCodeRepository,
  PrismaOAuthIdentityRepository,
  PrismaOAuthStateRepository,
  PrismaRecoveryRequestRepository,
  PrismaSessionRepository,
  PrismaUserRepository,
} from "./prisma-auth.repositories.ts";

export * from "./account-lifecycle.lock.ts";
export * from "./auth-record.persistence.ts";
export * from "./prisma-auth.mappers.ts";
export * from "./prisma-auth.repositories.ts";

export const AUTH_PERSISTENCE_PROVIDERS = [
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaAuditEventRepository,
  PrismaMfaEnrollmentRepository,
  PrismaMfaRateLimitRepository,
  PrismaMfaOtpUsedRepository,
  PrismaMfaRecoveryCodeRepository,
  PrismaRecoveryRequestRepository,
  PrismaOAuthStateRepository,
  PrismaOAuthIdentityRepository,
  {
    provide: AUTH_USER_REPOSITORY,
    useExisting: PrismaUserRepository,
  },
  {
    provide: AUTH_SESSION_REPOSITORY,
    useExisting: PrismaSessionRepository,
  },
  {
    provide: AUTH_AUDIT_EVENT_REPOSITORY,
    useExisting: PrismaAuditEventRepository,
  },
  {
    provide: AUTH_MFA_ENROLLMENT_REPOSITORY,
    useExisting: PrismaMfaEnrollmentRepository,
  },
  {
    provide: AUTH_MFA_RATE_LIMIT_REPOSITORY,
    useExisting: PrismaMfaRateLimitRepository,
  },
  {
    provide: AUTH_MFA_OTP_USED_REPOSITORY,
    useExisting: PrismaMfaOtpUsedRepository,
  },
  {
    provide: AUTH_MFA_RECOVERY_CODE_REPOSITORY,
    useExisting: PrismaMfaRecoveryCodeRepository,
  },
  {
    provide: AUTH_RECOVERY_REQUEST_REPOSITORY,
    useExisting: PrismaRecoveryRequestRepository,
  },
  {
    provide: AUTH_OAUTH_STATE_REPOSITORY,
    useExisting: PrismaOAuthStateRepository,
  },
  {
    provide: AUTH_OAUTH_IDENTITY_REPOSITORY,
    useExisting: PrismaOAuthIdentityRepository,
  },
] as const;
