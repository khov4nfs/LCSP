/**
 * Stable compatibility exports for existing injection and test imports.
 * Implementations are grouped by persistence responsibility in sibling files.
 */
export { PrismaUserRepository } from "./prisma-user.repository.ts";
export { PrismaSessionRepository } from "./prisma-session.repository.ts";
export { PrismaAuditEventRepository } from "./prisma-audit-event.repository.ts";
export {
  PrismaMfaEnrollmentRepository,
  PrismaMfaRateLimitRepository,
  PrismaMfaOtpUsedRepository,
  PrismaMfaRecoveryCodeRepository,
} from "./prisma-mfa.repositories.ts";
export { PrismaRecoveryRequestRepository } from "./prisma-recovery.repository.ts";
export {
  PrismaOAuthStateRepository,
  PrismaOAuthIdentityRepository,
} from "./prisma-oauth.repositories.ts";
