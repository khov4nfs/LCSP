import {
  AUTH_AUDIT_EVENT_REPOSITORY,
  AUTH_READ_REPOSITORY,
  AUTH_SECURITY_PERSISTENCE,
  AUTH_SIGN_UP_PERSISTENCE,
  AUTH_MFA_LIFECYCLE_PERSISTENCE,
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
import { PrismaAuthReadRepository } from "./prisma-auth-read.repository.ts";
import { PrismaAuthSecurityPersistence } from "./prisma-auth-security.persistence.ts";
import { PrismaMfaLifecyclePersistence } from "./prisma-mfa-lifecycle.persistence.ts";
import { PrismaSignUpPersistence } from "./prisma-sign-up.persistence.ts";
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
export * from "./prisma-auth-security.persistence.ts";
export * from "./prisma-mfa-lifecycle.persistence.ts";
export * from "./prisma-auth-read.repository.ts";
export * from "./prisma-sign-up.persistence.ts";

export const AUTH_PERSISTENCE_PROVIDERS = [
  PrismaUserRepository,
  PrismaAuthReadRepository,
  PrismaAuthSecurityPersistence,
  PrismaMfaLifecyclePersistence,
  PrismaSignUpPersistence,
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
    provide: AUTH_READ_REPOSITORY,
    useExisting: PrismaAuthReadRepository,
  },
  {
    provide: AUTH_SIGN_UP_PERSISTENCE,
    useExisting: PrismaSignUpPersistence,
  },
  {
    provide: AUTH_MFA_LIFECYCLE_PERSISTENCE,
    useExisting: PrismaMfaLifecyclePersistence,
  },
  {
    provide: AUTH_SECURITY_PERSISTENCE,
    useExisting: PrismaAuthSecurityPersistence,
  },
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
