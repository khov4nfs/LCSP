import type { AuthRecord, User as PrismaUser } from "@prisma/client";

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
} from "../../domain/models/auth-workspace.models.ts";
import {
  authRecordMetadataDate,
  authRecordMetadataString,
} from "./auth-record.persistence.ts";

export function mapUserRecord(record: PrismaUser): User {
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

export function mapRecoveryRequestRecord(record: AuthRecord): RecoveryRequest {
  return RecoveryRequest.rehydrate({
    id: record.id,
    userId: required(record.userId, "Recovery request userId"),
    tokenHash: required(record.secretHash, "Recovery request token hash"),
    expiresAt: required(record.expiresAt, "Recovery request expiry").getTime(),
    consumedAt: record.usedAt?.getTime() ?? null,
  });
}

export function mapSessionRecord(record: AuthRecord): Session {
  return Session.rehydrate({
    id: record.id,
    userId: required(record.userId, "Session userId"),
    tokenHash: required(record.secretHash, "Session token hash"),
    expiresAt: required(record.expiresAt, "Session expiry").getTime(),
    revokedAt: record.revokedAt?.getTime() ?? null,
    mfaVerifiedAt:
      authRecordMetadataDate(record, "mfaVerifiedAt")?.getTime() ?? null,
    sensitiveActionVerifiedAt:
      authRecordMetadataDate(record, "sensitiveActionVerifiedAt")?.getTime() ??
      null,
  });
}

export function mapMfaEnrollmentRecord(record: PrismaUser): MfaEnrollment {
  return new MfaEnrollment({
    userId: record.id,
    encryptedSecret: required(
      record.mfaEncryptedSecret,
      "MFA encrypted secret",
    ),
    enrolledAt: required(record.mfaEnrolledAt, "MFA enrollment time").getTime(),
    verifiedAt: record.mfaVerifiedAt?.getTime() ?? null,
  });
}

export function mapMfaRateLimitRecord(record: PrismaUser): MfaRateLimit {
  return new MfaRateLimit({
    userId: record.id,
    failedCount: record.mfaFailedCount,
    lockedUntil: record.mfaLockedUntil?.getTime() ?? null,
  });
}

export function mapOAuthStateRecord(record: AuthRecord): OAuthState {
  return OAuthState.rehydrate({
    id: record.id,
    state: required(
      authRecordMetadataString(record, "state"),
      "OAuth state value",
    ),
    nonce: required(
      authRecordMetadataString(record, "nonce"),
      "OAuth state nonce",
    ),
    provider: required(
      authRecordMetadataString(record, "provider"),
      "OAuth state provider",
    ),
    redirectUri: required(
      authRecordMetadataString(record, "redirectUri"),
      "OAuth redirect URI",
    ),
    expiresAt: required(record.expiresAt, "OAuth state expiry").getTime(),
    userId: record.userId,
    sessionId: authRecordMetadataString(record, "sessionId"),
  });
}

export function mapOAuthIdentityRecord(record: AuthRecord): OAuthIdentity {
  return OAuthIdentity.rehydrate({
    id: record.id,
    userId: required(record.userId, "OAuth identity userId"),
    provider: required(
      authRecordMetadataString(record, "provider"),
      "OAuth identity provider",
    ),
    providerAccountId: required(
      authRecordMetadataString(record, "providerAccountId"),
      "OAuth provider account ID",
    ),
    createdAt: record.createdAt.getTime(),
  });
}

export function dateFromEpochMs(value: number | null): Date | null {
  return value === null ? null : new Date(value);
}

export function dateFromEpochMsRequired(value: number): Date {
  return new Date(value);
}

function required<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new Error(`${label} is missing from AuthRecord persistence`);
  }
  return value;
}
