import type { AuthRecord, PrismaClient } from "@prisma/client";

import {
  fingerprintToken,
  hashSecret,
} from "../../src/modules/auth-workspace/infrastructure/security/security.utils.js";

export const AUTH_RECORD_TYPE = {
  session: "SESSION",
  mfaOtpUse: "MFA_OTP_USE",
  mfaRecoveryCode: "MFA_RECOVERY_CODE",
  recoveryRequest: "RECOVERY_REQUEST",
  oauthIdentity: "OAUTH_IDENTITY",
  oauthState: "OAUTH_STATE",
} as const;

export async function countAuthSessions(prisma: PrismaClient): Promise<number> {
  return prisma.authRecord.count({ where: { type: AUTH_RECORD_TYPE.session } });
}

export async function findLatestAuthSession(
  prisma: PrismaClient,
  userId: string,
): Promise<AuthRecord | null> {
  return prisma.authRecord.findFirst({
    where: { userId, type: AUTH_RECORD_TYPE.session },
    orderBy: { createdAt: "desc" },
  });
}

export function authRecordMetadata(
  record: Pick<AuthRecord, "metadata">,
): Record<string, unknown> {
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata;
}

export function authRecordMetadataString(
  record: Pick<AuthRecord, "metadata">,
  key: string,
): string | null {
  const value = authRecordMetadata(record)[key];
  return typeof value === "string" ? value : null;
}

export async function setSessionSensitiveActionVerifiedAt(
  prisma: PrismaClient,
  userId: string,
  value: Date | null,
): Promise<void> {
  const sessions = await prisma.authRecord.findMany({
    where: { userId, type: AUTH_RECORD_TYPE.session },
  });
  await Promise.all(
    sessions.map((session) =>
      prisma.authRecord.update({
        where: { id: session.id },
        data: {
          metadata: {
            ...authRecordMetadata(session),
            sensitiveActionVerifiedAt: value?.toISOString() ?? null,
          },
        },
      }),
    ),
  );
}

export async function createAuthSessionRecord(
  prisma: PrismaClient,
  input: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    revokedAt?: Date | null;
    mfaVerifiedAt?: Date | null;
    sensitiveActionVerifiedAt?: Date | null;
  },
): Promise<AuthRecord> {
  const tokenFingerprint = fingerprintToken(input.token);
  return prisma.authRecord.create({
    data: {
      id: input.id,
      userId: input.userId,
      type: AUTH_RECORD_TYPE.session,
      lookupKey: `SESSION:${tokenFingerprint}`,
      secretHash: hashSecret(input.token),
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt ?? null,
      metadata: {
        tokenFingerprint,
        mfaVerifiedAt: input.mfaVerifiedAt?.toISOString() ?? null,
        sensitiveActionVerifiedAt:
          input.sensitiveActionVerifiedAt?.toISOString() ?? null,
      },
    },
  });
}

export async function createOAuthStateRecord(
  prisma: PrismaClient,
  input: {
    id: string;
    state: string;
    nonce: string;
    provider: string;
    redirectUri: string;
    expiresAt: Date;
    userId?: string | null;
    sessionId?: string | null;
  },
): Promise<AuthRecord> {
  return prisma.authRecord.create({
    data: {
      id: input.id,
      userId: input.userId ?? null,
      type: AUTH_RECORD_TYPE.oauthState,
      lookupKey: `OAUTH_STATE:${input.state}`,
      expiresAt: input.expiresAt,
      metadata: {
        state: input.state,
        nonce: input.nonce,
        provider: input.provider,
        redirectUri: input.redirectUri,
        sessionId: input.sessionId ?? null,
      },
    },
  });
}

export async function findOAuthStateRecord(
  prisma: PrismaClient,
  state?: string,
): Promise<AuthRecord | null> {
  return prisma.authRecord.findFirst({
    where: {
      type: AUTH_RECORD_TYPE.oauthState,
      ...(state ? { lookupKey: `OAUTH_STATE:${state}` } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createOAuthIdentityRecord(
  prisma: PrismaClient,
  input: {
    id: string;
    userId: string;
    provider: string;
    providerAccountId: string;
  },
): Promise<AuthRecord> {
  return prisma.authRecord.create({
    data: {
      id: input.id,
      userId: input.userId,
      type: AUTH_RECORD_TYPE.oauthIdentity,
      lookupKey: `OAUTH_IDENTITY:${input.provider}:${input.providerAccountId}`,
      metadata: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
  });
}
