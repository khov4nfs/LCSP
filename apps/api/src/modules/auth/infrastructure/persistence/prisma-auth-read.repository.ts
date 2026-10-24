import type { AuthUserRole } from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";

import {
  fromPrismaAuthBackupEmailPolicy,
  fromPrismaAuthPrimaryEmailAddressPolicy,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  AuthProfileSuccess,
  AuthSessionsSuccess,
} from "../../application/contracts/auth/settings.contract.ts";
import type { AuthReadRepository } from "../../application/ports/persistence/auth-read.repository.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordMetadataDate,
} from "./auth-record.persistence.ts";

@Injectable()
export class PrismaAuthReadRepository implements AuthReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(
    userId: string,
    sessionId: string,
    role: AuthUserRole,
  ): Promise<AuthProfileSuccess | null> {
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.authRecord.findFirst({
        where: {
          id: sessionId,
          userId,
          type: AUTH_RECORD_TYPES.session,
        },
      }),
    ]);

    if (!user || !session || !session.expiresAt) return null;

    const mfaEnrolled =
      user.mfaEncryptedSecret !== null && user.mfaVerifiedAt !== null;
    const sessionMfaVerifiedAt = authRecordMetadataDate(
      session,
      "mfaVerifiedAt",
    );

    return {
      ok: true,
      user_id: user.id,
      email: user.email,
      email_verified: user.emailVerified,
      display_name: user.displayName,
      recovery_email: user.recoveryEmail,
      primary_email_address_policy: fromPrismaAuthPrimaryEmailAddressPolicy(
        user.primaryEmailAddressPolicy,
      ),
      backup_recovery_email_policy: fromPrismaAuthBackupEmailPolicy(
        user.backupEmailPolicy,
      ),
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
      role,
      mfa_enrolled: mfaEnrolled,
      mfa_enrolled_at: mfaEnrolled
        ? (user.mfaVerifiedAt?.toISOString() ?? null)
        : null,
      mfa_verified: sessionMfaVerifiedAt !== null,
      mfa_verified_at: sessionMfaVerifiedAt?.toISOString() ?? null,
      current_session_id: session.id,
      current_session_created_at: session.createdAt.toISOString(),
      current_session_updated_at: session.updatedAt.toISOString(),
      current_session_expires_at: session.expiresAt.toISOString(),
    };
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<AuthSessionsSuccess> {
    const sessions = await this.prisma.authRecord.findMany({
      where: { userId, type: AUTH_RECORD_TYPES.session },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    return {
      ok: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        expires_at: requireSessionExpiration(session.expiresAt).toISOString(),
        revoked_at: session.revokedAt?.toISOString() ?? null,
        mfa_verified_at:
          authRecordMetadataDate(session, "mfaVerifiedAt")?.toISOString() ??
          null,
        is_current: session.id === currentSessionId,
      })),
    };
  }

  async sessionSensitiveActionVerifiedAt(
    sessionId: string,
  ): Promise<Date | null> {
    const record = await this.prisma.authRecord.findFirst({
      where: { id: sessionId, type: AUTH_RECORD_TYPES.session },
      select: { metadata: true },
    });
    return record
      ? authRecordMetadataDate(record, "sensitiveActionVerifiedAt")
      : null;
  }
}

function requireSessionExpiration(value: Date | null): Date {
  if (!value) {
    throw new Error("SESSION_EXPIRES_AT_MISSING");
  }
  return value;
}
