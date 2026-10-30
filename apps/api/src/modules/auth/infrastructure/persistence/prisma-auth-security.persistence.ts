import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { isSensitiveActionVerificationFresh } from "../../../../platform/security/sensitive-route-policy.js";
import type {
  AuthSecurityPersistence,
  DisableMfaCommit,
  DisableMfaResult,
  PasswordRecoveryCommit,
} from "../../application/ports/persistence/auth-security.persistence.ts";
import { AuthAuditService } from "../../application/services/auth/auth-audit.service.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordMetadataDate,
  authRecordMetadataString,
  invalidateSessionProofsInTx,
} from "./auth-record.persistence.ts";

@Injectable()
export class PrismaAuthSecurityPersistence implements AuthSecurityPersistence {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuthAuditService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async completePasswordRecovery(
    input: PasswordRecoveryCommit,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Lock the account before consuming the token, changing credentials or
      // revoking sessions. This also serializes against admin lifecycle writes.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`,
      );
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { accessStatus: true },
      });
      if (!user || user.accessStatus !== USER_ACCESS_STATUSES.active)
        return false;

      // Atomic conditional claim makes parallel requests for the same token
      // single-use even if both passed the handler's preliminary read.
      const consumed = await tx.authRecord.updateMany({
        where: {
          id: input.requestId,
          userId: input.userId,
          type: AUTH_RECORD_TYPES.recoveryRequest,
          usedAt: null,
          expiresAt: { gt: new Date(input.now) },
        },
        data: { usedAt: new Date(input.now) },
      });
      if (consumed.count !== 1) return false;

      await tx.user.update({
        where: { id: input.userId },
        data: {
          passwordHash: input.passwordHash,
          failedLoginCount: 0,
          lockUntil: null,
          // Invalidate even a concurrent login that read the previous password.
          accessVersion: { increment: 1 },
        },
      });
      await tx.authRecord.updateMany({
        where: {
          userId: input.userId,
          type: AUTH_RECORD_TYPES.session,
          revokedAt: null,
          expiresAt: { gt: new Date(input.now) },
        },
        data: { revokedAt: new Date(input.now) },
      });
      await this.audit.writeInTx(
        {
          event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryConfirmed,
          actor_id: input.userId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
        },
        this.auditWriter.forTransaction(tx),
      );
      return true;
    });
  }

  /**
   * Business purpose: Disable MFA without leaving usable recovery codes or elevated sessions.
   *
   * Business rules:
   * - The initiator must present current-generation verified MFA proof.
   * - The session must present fresh password re-authentication proof (sensitiveActionVerifiedAt).
   * - All session MFA/sensitive proofs and recovery codes must be invalidated in the same transaction.
   *
   * Execution flow:
   * 1. Lock and authenticate the owning user/session against the current generation.
   * 2. Verify sensitive-action freshness.
   * 3. Clear the MFA enrollment and rotate the account proof generation.
   * 4. Clear all session proofs, revoke recovery codes, delete old OTP markers and write audit.
   *
   * Failure cases:
   * - Stale session proof or missing/expired password re-auth rejects disable without changing the factor.
   * - Any write or audit failure rolls back the entire disable operation.
   *
   * Side effects:
   * - Mutates the account, all its session proof metadata, recovery codes and audit records.
   */
  async disableMfa(input: DisableMfaCommit): Promise<DisableMfaResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`,
      );
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user || user.accessStatus !== USER_ACCESS_STATUSES.active) {
        return { ok: false, code: AUTH_ERROR_CODES.sessionInvalid };
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "AuthRecord" WHERE "id" = ${input.sessionId} FOR UPDATE`,
      );
      const session = await tx.authRecord.findFirst({
        where: {
          id: input.sessionId,
          userId: input.userId,
          type: AUTH_RECORD_TYPES.session,
          revokedAt: null,
          expiresAt: { gt: new Date(input.now) },
        },
      });
      if (!session) return { ok: false, code: AUTH_ERROR_CODES.sessionInvalid };
      const metadata = (session.metadata as Prisma.JsonObject | null) ?? {};
      const accessVersion = Number(metadata.accessVersion ?? 0);
      if (accessVersion !== user.accessVersion) {
        return { ok: false, code: AUTH_ERROR_CODES.sessionInvalid };
      }
      if (
        !authRecordMetadataDate(session, "mfaVerifiedAt") ||
        authRecordMetadataString(session, "mfaGenerationId") !==
          user.mfaGenerationId ||
        user.mfaVerifiedAt === null
      ) {
        return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
      }
      if (
        !isSensitiveActionVerificationFresh(
          authRecordMetadataDate(session, "passwordReauthenticatedAt"),
          input.now,
        )
      ) {
        return { ok: false, code: AUTH_ERROR_CODES.reauthRequired };
      }
      if (!user.mfaEncryptedSecret || !user.mfaEnrolledAt) return { ok: true };

      const nextGenerationId = randomUUID();
      await tx.user.update({
        where: { id: input.userId },
        data: {
          mfaEncryptedSecret: null,
          mfaEnrolledAt: null,
          mfaVerifiedAt: null,
          mfaRequired: false,
          mfaGenerationId: nextGenerationId,
        },
      });
      await invalidateSessionProofsInTx(tx, input.userId, nextGenerationId);
      await tx.authRecord.updateMany({
        where: {
          userId: input.userId,
          type: AUTH_RECORD_TYPES.mfaRecoveryCode,
          revokedAt: null,
          usedAt: null,
        },
        data: { revokedAt: new Date(input.now) },
      });
      // TOTP replay history belongs to the retired generation as well.
      await tx.authRecord.deleteMany({
        where: {
          userId: input.userId,
          type: AUTH_RECORD_TYPES.mfaOtpUse,
        },
      });
      await this.audit.writeInTx(
        {
          event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaDisabled,
          actor_id: input.userId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          session_id: input.sessionId,
        },
        this.auditWriter.forTransaction(tx),
      );
      return { ok: true };
    });
  }
}
