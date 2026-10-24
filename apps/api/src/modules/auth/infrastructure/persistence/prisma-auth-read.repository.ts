import { USER_ACCESS_STATUSES, type AuthUserRole } from "@lcsp/contracts/auth";
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
  authRecordMetadataString,
} from "./auth-record.persistence.ts";

@Injectable()
export class PrismaAuthReadRepository implements AuthReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Present an authenticated account's current MFA verification status.
   *
   * Business rules:
   * - An MFA timestamp is meaningful only when both enrollment and session match the active generation.
   *
   * Execution flow:
   * 1. Read the owner and current session, then compare the session proof generation with the account.
   * 2. Project safe profile data and only valid current-generation MFA verification timestamps.
   *
   * Failure cases:
   * - A missing owner/session produces no profile; stale proofs are presented as unverified.
   *
   * Side effects:
   * - None: returns a read-only profile projection.
   */
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
    const sessionMfaVerifiedAt =
      mfaEnrolled &&
      authRecordMetadataString(session, "mfaGenerationId") ===
        user.mfaGenerationId
        ? authRecordMetadataDate(session, "mfaVerifiedAt")
        : null;

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

  /**
   * Business purpose: Display the account's sessions without reporting stale MFA elevation.
   *
   * Business rules:
   * - Session MFA proof is reportable only if its generation is the current confirmed factor.
   *
   * Execution flow:
   * 1. Read account generation and all owned sessions.
   * 2. Remove stale MFA timestamps from the resulting session list projection.
   *
   * Failure cases:
   * - Missing or disabled MFA never makes old proof metadata appear verified.
   *
   * Side effects:
   * - None: reads and projects session metadata.
   */
  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<AuthSessionsSuccess> {
    const [sessions, user] = await Promise.all([
      this.prisma.authRecord.findMany({
        where: { userId, type: AUTH_RECORD_TYPES.session },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          mfaGenerationId: true,
          mfaEncryptedSecret: true,
          mfaVerifiedAt: true,
        },
      }),
    ]);

    return {
      ok: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        expires_at: requireSessionExpiration(session.expiresAt).toISOString(),
        revoked_at: session.revokedAt?.toISOString() ?? null,
        mfa_verified_at:
          user?.mfaEncryptedSecret &&
          user.mfaVerifiedAt &&
          authRecordMetadataString(session, "mfaGenerationId") ===
            user.mfaGenerationId
            ? (authRecordMetadataDate(
                session,
                "mfaVerifiedAt",
              )?.toISOString() ?? null)
            : null,
        is_current: session.id === currentSessionId,
      })),
    };
  }

  /**
   * Business purpose: Return a valid sensitive-action step-up proof for the requested session.
   *
   * Business rules:
   * - Proof is void when account generation/access version differs from the stored session.
   * - Accounts requiring MFA must additionally have an active MFA-verified session.
   *
   * Execution flow:
   * 1. Read the active, unrevoked session and owner account.
   * 2. Enforce account access state, proof generation and MFA confirmation gates.
   * 3. Return only the valid reauthentication timestamp.
   *
   * Failure cases:
   * - Stale/revoked sessions or pending MFA produce no valid proof timestamp.
   *
   * Side effects:
   * - None: read-only authorization projection.
   */
  async sessionSensitiveActionVerifiedAt(
    sessionId: string,
  ): Promise<Date | null> {
    const record = await this.prisma.authRecord.findFirst({
      where: {
        id: sessionId,
        type: AUTH_RECORD_TYPES.session,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        metadata: true,
        user: {
          select: {
            accessStatus: true,
            accessVersion: true,
            mfaGenerationId: true,
            mfaRequired: true,
            mfaEncryptedSecret: true,
            mfaVerifiedAt: true,
          },
        },
      },
    });
    const user = record?.user;
    if (
      !user ||
      user.accessStatus !== USER_ACCESS_STATUSES.active ||
      Number(
        (record.metadata as Record<string, unknown> | null)?.accessVersion ?? 0,
      ) !== user.accessVersion ||
      authRecordMetadataString(record, "mfaGenerationId") !==
        user.mfaGenerationId ||
      ((user.mfaRequired ||
        (user.mfaEncryptedSecret !== null && user.mfaVerifiedAt !== null)) &&
        (user.mfaVerifiedAt === null ||
          authRecordMetadataDate(record, "mfaVerifiedAt") === null))
    ) {
      return null;
    }
    return authRecordMetadataDate(record, "sensitiveActionVerifiedAt");
  }
}

function requireSessionExpiration(value: Date | null): Date {
  if (!value) {
    throw new Error("SESSION_EXPIRES_AT_MISSING");
  }
  return value;
}
