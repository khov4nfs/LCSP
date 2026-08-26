import type {
  AuthAuditEvent,
  AuthDecisionLog,
  AuthMfaRateLimit,
  AuthOAuthIdentity,
  AuthOAuthState,
  AuthRecoveryRequest,
  AuthSession,
  AuthUser,
  AuthUserMfa,
  Prisma,
} from "@prisma/client";

import {
  fromPrismaAuthBackupEmailPolicy,
  fromPrismaAuthPrimaryEmailAddressPolicy,
  fromPrismaAuthUserRole,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import {
  MfaEnrollment,
  MfaRateLimit,
  OAuthIdentity,
  OAuthState,
  RecoveryRequest,
  Session,
  User,
  type AuditEvent,
  type AuthorizationDecision,
} from "../../domain/models/auth-workspace.models.ts";

export function mapUserRecord(record: AuthUser): User {
  return User.rehydrate({
    id: record.id,
    email: record.email,
    passwordHash: record.passwordHash,
    emailVerified: record.emailVerified,
    failedLoginCount: record.failedLoginCount,
    lockUntil: record.lockUntil?.getTime() ?? null,
    displayName: record.displayName ?? null,
    recoveryEmail: record.recoveryEmail ?? null,
    primaryEmailAddressPolicy: fromPrismaAuthPrimaryEmailAddressPolicy(
      record.primaryEmailAddressPolicy,
    ),
    backupEmailPolicy: fromPrismaAuthBackupEmailPolicy(
      record.backupEmailPolicy,
    ),
    role: fromPrismaAuthUserRole(record.role),
    mfaRequired: record.mfaRequired,
  });
}

export function mapRecoveryRequestRecord(
  record: AuthRecoveryRequest,
): RecoveryRequest {
  return RecoveryRequest.rehydrate({
    id: record.id,
    userId: record.userId,
    tokenHash: record.tokenHash,
    expiresAt: record.expiresAt.getTime(),
    consumedAt: record.consumedAt?.getTime() ?? null,
  });
}

export function mapSessionRecord(record: AuthSession): Session {
  return Session.rehydrate({
    id: record.id,
    userId: record.userId,
    tokenHash: record.tokenHash,
    expiresAt: record.expiresAt.getTime(),
    revokedAt: record.revokedAt?.getTime() ?? null,
    mfaVerifiedAt: record.mfaVerifiedAt?.getTime() ?? null,
    sensitiveActionVerifiedAt:
      record.sensitiveActionVerifiedAt?.getTime() ?? null,
  });
}

export function mapMfaEnrollmentRecord(record: AuthUserMfa): MfaEnrollment {
  return new MfaEnrollment({
    userId: record.userId,
    encryptedSecret: record.encryptedSecret,
    enrolledAt: record.enrolledAt.getTime(),
    verifiedAt: record.verifiedAt?.getTime() ?? null,
  });
}

export function mapMfaRateLimitRecord(record: AuthMfaRateLimit): MfaRateLimit {
  return new MfaRateLimit({
    userId: record.userId,
    failedCount: record.failedCount,
    lockedUntil: record.lockedUntil?.getTime() ?? null,
  });
}

export function mapOAuthStateRecord(record: AuthOAuthState): OAuthState {
  return OAuthState.rehydrate({
    id: record.id,
    state: record.state,
    nonce: record.nonce,
    provider: record.provider,
    redirectUri: record.redirectUri,
    expiresAt: record.expiresAt.getTime(),
    userId: record.userId,
    sessionId: record.sessionId,
  });
}

export function mapOAuthIdentityRecord(
  record: AuthOAuthIdentity,
): OAuthIdentity {
  return OAuthIdentity.rehydrate({
    id: record.id,
    userId: record.userId,
    provider: record.provider,
    providerAccountId: record.providerAccountId,
    createdAt: record.createdAt.getTime(),
  });
}

export function mapAuditEventRecord(record: AuthAuditEvent): AuditEvent {
  return jsonToAuditEvent(record.payload);
}

export function mapAuthorizationDecisionRecord(
  record: AuthDecisionLog,
): AuthorizationDecision {
  return jsonToAuthorizationDecision(record.payload);
}

export function dateFromEpochMs(value: number | null): Date | null {
  return value === null ? null : new Date(value);
}

export function dateFromEpochMsRequired(value: number): Date {
  return new Date(value);
}

function jsonToAuditEvent(value: Prisma.JsonValue): AuditEvent {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  return value;
}

function jsonToAuthorizationDecision(
  value: Prisma.JsonValue,
): AuthorizationDecision {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Invalid authorization decision payload");
  }

  return value as AuthorizationDecision;
}
