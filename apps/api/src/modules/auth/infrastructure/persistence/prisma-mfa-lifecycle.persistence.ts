import * as crypto from "node:crypto";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { Prisma, type AuthRecord, type User } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { MFA_PROOF_TYPES } from "../../application/ports/persistence/mfa-lifecycle.persistence.ts";
import type {
  MfaEnrollmentCommit,
  MfaLifecyclePersistence,
  MfaRecoveryCodesCommit,
  MfaProofCommit,
  MfaProofCommitResult,
  MfaTransactionResult,
} from "../../application/ports/persistence/mfa-lifecycle.persistence.ts";
import type { MfaRecoveryCodeCreateInput } from "../../application/ports/persistence/mfa.repository.ts";
import { AuthAuditService } from "../../application/services/auth/auth-audit.service.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordLookupKey,
  authRecordMetadata,
  authRecordMetadataDate,
} from "./auth-record.persistence.ts";

@Injectable()
export class PrismaMfaLifecyclePersistence implements MfaLifecyclePersistence {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuthAuditService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async enroll(input: MfaEnrollmentCommit): Promise<MfaTransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAccountAndSession(
        tx,
        input.userId,
        input.sessionId,
        input.now,
      );
      if (!current.ok) return current;

      const { user, session } = current;
      if (user.mfaEncryptedSecret !== input.expectedEncryptedSecret) {
        return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
      }

      if (
        user.mfaEncryptedSecret !== null &&
        !authRecordMetadataDate(session, "mfaVerifiedAt") &&
        !input.allowUnverifiedReplacement
      ) {
        return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
      }

      // Everything below is a single transaction. A failure to write audit,
      // code records, enrollment, or rate limits rolls back all changes.
      await tx.user.update({
        where: { id: input.userId },
        data: {
          mfaEncryptedSecret: input.enrollment.encryptedSecret,
          mfaEnrolledAt: new Date(input.enrollment.enrolledAt),
          mfaVerifiedAt: null,
          mfaFailedCount: 0,
          mfaLockedUntil: null,
        },
      });
      await tx.authRecord.deleteMany({
        where: {
          userId: input.userId,
          type: AUTH_RECORD_TYPES.mfaOtpUse,
        },
      });

      const activeCodeCount = await tx.authRecord.count({
        where: {
          userId: input.userId,
          type: AUTH_RECORD_TYPES.mfaRecoveryCode,
          usedAt: null,
          revokedAt: null,
        },
      });

      const recoveryCodesCreated = activeCodeCount === 0;
      if (recoveryCodesCreated) {
        await this.replaceCodeRecords(
          tx,
          input.userId,
          input.candidateBatchId,
          input.candidateCodes,
          input.now,
        );
        await this.writeCodeAudit(
          tx,
          input.userId,
          input.sessionId,
          input.correlationId,
          input.candidateBatchId,
          input.candidateCodes.length,
        );
      }
      await this.audit.writeInTx(
        {
          event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled,
          actor_id: input.userId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
        },
        this.auditWriter.forTransaction(tx),
      );
      return { ok: true, recoveryCodesCreated };
    });
  }

  async replaceRecoveryCodes(
    input: MfaRecoveryCodesCommit,
  ): Promise<MfaTransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAccountAndSession(
        tx,
        input.userId,
        input.sessionId,
        input.now,
      );
      if (!current.ok) return current;
      const { user, session } = current;
      if (
        !authRecordMetadataDate(session, "mfaVerifiedAt") ||
        !user.mfaEncryptedSecret ||
        !user.mfaVerifiedAt ||
        user.mfaEncryptedSecret !== input.expectedEncryptedSecret
      ) {
        return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
      }

      await this.replaceCodeRecords(
        tx,
        input.userId,
        input.batchId,
        input.codes,
        input.now,
      );
      await this.writeCodeAudit(
        tx,
        input.userId,
        input.sessionId,
        input.correlationId,
        input.batchId,
        input.codes.length,
      );

      return { ok: true, recoveryCodesCreated: true };
    });
  }

  async verifyProof(input: MfaProofCommit): Promise<MfaProofCommitResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await this.lockAccountAndSession(
          tx,
          input.userId,
          input.sessionId,
          input.now,
        );
        if (!current.ok) return current;
        const { user, session } = current;
        if (
          !user.mfaEncryptedSecret ||
          user.mfaEncryptedSecret !== input.expectedEncryptedSecret ||
          !user.mfaEnrolledAt
        ) {
          return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
        }
        if (user.mfaLockedUntil && user.mfaLockedUntil > new Date(input.now)) {
          return { ok: false, code: AUTH_ERROR_CODES.mfaRateLimited };
        }

        if (input.proof.kind === MFA_PROOF_TYPES.otp) {
          await tx.authRecord.create({
            data: {
              id: crypto.randomUUID(),
              userId: input.userId,
              type: AUTH_RECORD_TYPES.mfaOtpUse,
              lookupKey: authRecordLookupKey(
                AUTH_RECORD_TYPES.mfaOtpUse,
                input.userId,
                input.proof.otp,
              ),
              usedAt: new Date(input.now),
              metadata: { otpCode: input.proof.otp },
            },
          });
          await tx.authRecord.deleteMany({
            where: {
              userId: input.userId,
              type: AUTH_RECORD_TYPES.mfaOtpUse,
              usedAt: { lt: new Date(input.now - 5 * 60_000) },
            },
          });
        } else {
          const consumed = await tx.authRecord.updateMany({
            where: {
              userId: input.userId,
              type: AUTH_RECORD_TYPES.mfaRecoveryCode,
              lookupKey: authRecordLookupKey(
                AUTH_RECORD_TYPES.mfaRecoveryCode,
                input.userId,
                input.proof.codeHash,
              ),
              revokedAt: null,
              usedAt: null,
            },
            data: { usedAt: new Date(input.now) },
          });
          if (consumed.count !== 1) {
            return { ok: false, code: AUTH_ERROR_CODES.mfaInvalid };
          }
        }

        // Proof consumption, account MFA state, session step-up and audit are
        // committed together. Failure leaves a recovery code reusable.
        await tx.user.update({
          where: { id: input.userId },
          data: {
            mfaVerifiedAt: new Date(input.now),
            mfaRequired: true,
            mfaFailedCount: 0,
            mfaLockedUntil: null,
          },
        });
        await tx.authRecord.update({
          where: { id: input.sessionId },
          data: {
            metadata: {
              ...authRecordMetadata(session.metadata),
              mfaVerifiedAt: new Date(input.now).toISOString(),
              sensitiveActionVerifiedAt: new Date(input.now).toISOString(),
            },
          },
        });

        await this.audit.writeInTx(
          input.proof.kind === MFA_PROOF_TYPES.otp
            ? {
                event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaVerified,
                actor_id: input.userId,
                decision: AUDIT_DECISIONS.allow,
                correlationId: input.correlationId,
              }
            : {
                event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeUsed,
                actor_id: input.userId,
                resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
                resource_id: input.userId,
                decision: AUDIT_DECISIONS.allow,
                correlationId: input.correlationId,
                session_id: input.sessionId,
              },
          this.auditWriter.forTransaction(tx),
        );
        return { ok: true };
      });
    } catch (error) {
      if (
        input.proof.kind === MFA_PROOF_TYPES.otp &&
        isUniqueConstraintViolation(error)
      ) {
        return { ok: false, code: AUTH_ERROR_CODES.mfaInvalid };
      }
      throw error;
    }
  }

  private async lockAccountAndSession(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
    now: number,
  ): Promise<
    | { ok: true; user: User; session: AuthRecord }
    | Extract<MfaTransactionResult, { ok: false }>
  > {
    // Lock order matches Disable MFA: User -> Session.
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return { ok: false, code: AUTH_ERROR_CODES.sessionInvalid };
    if (user.accessStatus !== USER_ACCESS_STATUSES.active) {
      return { ok: false, code: AUTH_ERROR_CODES.accountSuspended };
    }

    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AuthRecord" WHERE "id" = ${sessionId} FOR UPDATE`,
    );
    const session = await tx.authRecord.findFirst({
      where: {
        id: sessionId,
        userId,
        type: AUTH_RECORD_TYPES.session,
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
      },
    });
    if (!session) return { ok: false, code: AUTH_ERROR_CODES.sessionInvalid };
    const metadata = authRecordMetadata(session.metadata);
    if (Number(metadata.accessVersion ?? 0) !== user.accessVersion) {
      return { ok: false, code: AUTH_ERROR_CODES.sessionInvalid };
    }
    return { ok: true, user, session };
  }

  private async replaceCodeRecords(
    tx: Prisma.TransactionClient,
    userId: string,
    batchId: string,
    codes: readonly MfaRecoveryCodeCreateInput[],
    now: number,
  ): Promise<void> {
    await tx.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        revokedAt: null,
        usedAt: null,
      },
      data: { revokedAt: new Date(now) },
    });
    await tx.authRecord.createMany({
      data: codes.map((record) => ({
        id: record.id,
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.mfaRecoveryCode,
          userId,
          record.codeHash,
        ),
        secretHash: record.codeHash,
        metadata: { batchId },
        createdAt: new Date(now),
      })),
    });
  }

  private async writeCodeAudit(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
    correlationId: string,
    batchId: string,
    count: number,
  ): Promise<void> {
    const writer = this.auditWriter.forTransaction(tx);
    await this.audit.writeInTx(
      {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodesGenerated,
        actor_id: userId,
        resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
        resource_id: batchId,
        decision: AUDIT_DECISIONS.allow,
        correlationId,
        session_id: sessionId,
        batch_id: batchId,
        code_count: count,
      },
      writer,
    );
    await this.audit.writeInTx(
      {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeViewed,
        actor_id: userId,
        resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
        resource_id: batchId,
        decision: AUDIT_DECISIONS.allow,
        correlationId,
        session_id: sessionId,
        batch_id: batchId,
      },
      writer,
    );
  }
}
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
