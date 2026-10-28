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
import { isSensitiveActionVerificationFresh } from "../../../../platform/security/sensitive-route-policy.js";
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
  authRecordMetadataString,
  invalidateSessionProofsInTx,
} from "./auth-record.persistence.ts";

@Injectable()
export class PrismaMfaLifecyclePersistence implements MfaLifecyclePersistence {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuthAuditService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Business purpose: Install a new TOTP generation and rotate all account backup credentials.
   *
   * Business rules:
   * - An existing verified MFA secret requires verified proof of its current generation and fresh password re-auth to rotate.
   * - Unverified/abandoned enrollments can be restarted without prior factor proof.
   * - Prior recovery codes and all session step-up proofs must become invalid in one transaction.
   * - A new backup batch must not be used before the replacement TOTP has been verified.
   *
   * Execution flow:
   * 1. Lock the User and originating session, then verify the existing credential generation and sensitive-action freshness.
   * 2. Advance the generation and replace the encrypted TOTP secret.
   * 3. Invalidate all session proofs, used TOTP history and active recovery codes.
   * 4. Persist the new code batch and security audit atomically.
   *
   * Failure cases:
   * - Unverified/stale sessions, obsolete secrets, or missing password step-up are rejected without mutation.
   * - Failed audit or database writes roll back the entire rotation.
   *
   * Side effects:
   * - Rotates user MFA state, session proof metadata, recovery codes and audit records.
   */
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

      // Rotating an existing verified factor requires proof for the currently active
      // generation and fresh password re-authentication.
      // An abandoned/unverified setup (user.mfaVerifiedAt === null) is safe to restart.
      const isRotation =
        user.mfaEncryptedSecret !== null && user.mfaVerifiedAt !== null;

      if (isRotation) {
        if (
          !authRecordMetadataDate(session, "mfaVerifiedAt") ||
          authRecordMetadataString(session, "mfaGenerationId") !==
            user.mfaGenerationId
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

        // Staged replacement:
        // Do NOT overwrite user.mfaEncryptedSecret or clear user.mfaVerifiedAt on the User row.
        // Stage the replacement secret and candidate recovery codes bound to the initiating session.
        const candidateGenerationId = crypto.randomUUID();
        await tx.authRecord.update({
          where: { id: input.sessionId },
          data: {
            metadata: {
              ...authRecordMetadata(session.metadata),
              candidateMfaEnrollment: {
                encryptedSecret: input.enrollment.encryptedSecret,
                generationId: candidateGenerationId,
                batchId: input.candidateBatchId,
                enrolledAt: input.enrollment.enrolledAt,
              },
            },
          },
        });

        await this.replaceCandidateCodeRecords(
          tx,
          input.userId,
          candidateGenerationId,
          input.candidateBatchId,
          input.candidateCodes,
          input.now,
          user.mfaGenerationId,
        );

        await this.writeCodeAudit(
          tx,
          input.userId,
          input.sessionId,
          input.correlationId,
          input.candidateBatchId,
          input.candidateCodes.length,
        );

        return { ok: true, recoveryCodesCreated: true };
      }

      // Initial unverified setup: save directly to User and replace codes
      const nextGenerationId = crypto.randomUUID();
      await tx.user.update({
        where: { id: input.userId },
        data: {
          mfaEncryptedSecret: input.enrollment.encryptedSecret,
          mfaGenerationId: nextGenerationId,
          mfaEnrolledAt: new Date(input.enrollment.enrolledAt),
          mfaVerifiedAt: null,
          mfaFailedCount: 0,
          mfaLockedUntil: null,
        },
      });
      await invalidateSessionProofsInTx(tx, input.userId, nextGenerationId);
      await tx.authRecord.deleteMany({
        where: {
          userId: input.userId,
          type: AUTH_RECORD_TYPES.mfaOtpUse,
        },
      });

      // Every secret generation owns a fresh batch. Keeping the previous
      // batch would allow credentials for S1 to verify the new secret S2.
      await this.replaceCodeRecords(
        tx,
        input.userId,
        nextGenerationId,
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
      await this.audit.writeInTx(
        {
          event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled,
          actor_id: input.userId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
        },
        this.auditWriter.forTransaction(tx),
      );
      return { ok: true, recoveryCodesCreated: true };
    });
  }

  /**
   * Business purpose: Regenerate only the recovery-code batch of the current verified factor.
   *
   * Business rules:
   * - Code regeneration requires a current-generation verified session and an active MFA enrollment.
   * - No previous active backup code remains valid after regeneration commits.
   *
   * Execution flow:
   * 1. Lock the account/session and revalidate its verified generation and secret.
   * 2. Revoke the old batch and persist a fresh generation-bound code batch with audit.
   *
   * Failure cases:
   * - A stale generation, missing factor or transactional failure cannot expose new codes.
   *
   * Side effects:
   * - Atomically replaces recovery code rows and writes security audit records.
   */
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
        authRecordMetadataString(session, "mfaGenerationId") !==
          user.mfaGenerationId ||
        !user.mfaEncryptedSecret ||
        !user.mfaVerifiedAt ||
        user.mfaEncryptedSecret !== input.expectedEncryptedSecret
      ) {
        return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
      }

      await this.replaceCodeRecords(
        tx,
        input.userId,
        user.mfaGenerationId,
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

  /**
   * Business purpose: Authenticate the active MFA generation using TOTP or a single-use recovery code.
   *
   * Business rules:
   * - Proof must match the current encrypted secret and the active account generation.
   * - Recovery codes are unusable until the current TOTP generation has been verified once.
   * - Consuming proof, elevating the session and security audit must be one transaction.
   *
   * Execution flow:
   * 1. Lock the account/session and recheck rate limiting and current enrollment identity.
   * 2. Consume a unique OTP counter or a recovery code from the matching generation.
   * 3. Mark the account/session verified and audit the accepted proof atomically.
   *
   * Failure cases:
   * - Stale secret, used code, wrong generation or active lockout rejects elevation.
   * - Audit and persistence failures roll back proof consumption and session elevation.
   *
   * Side effects:
   * - Consumes proof records, sets MFA/session verification timestamps and writes audit.
   */
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

        if (input.candidate) {
          const sessionCandidate = authRecordMetadata(session.metadata)
            .candidateMfaEnrollment as
            | {
                encryptedSecret: string;
                generationId: string;
                batchId: string;
                enrolledAt: number;
              }
            | undefined;
          if (
            !sessionCandidate ||
            sessionCandidate.encryptedSecret !==
              input.candidate.encryptedSecret ||
            sessionCandidate.generationId !== input.candidate.generationId
          ) {
            return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
          }
        } else {
          if (
            !user.mfaEncryptedSecret ||
            user.mfaEncryptedSecret !== input.expectedEncryptedSecret ||
            !user.mfaEnrolledAt
          ) {
            return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
          }
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
          // A newly issued backup batch is not an alternative to proving
          // ownership of the replacement TOTP secret for the first time.
          if (!user.mfaVerifiedAt) {
            return { ok: false, code: AUTH_ERROR_CODES.mfaRequired };
          }
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
              metadata: {
                path: ["mfaGenerationId"],
                equals: user.mfaGenerationId,
              },
            },
            data: { usedAt: new Date(input.now) },
          });
          if (consumed.count !== 1) {
            return { ok: false, code: AUTH_ERROR_CODES.mfaInvalid };
          }
        }

        if (input.candidate) {
          // Commit the staged rotation atomically
          await tx.user.update({
            where: { id: input.userId },
            data: {
              mfaEncryptedSecret: input.candidate.encryptedSecret,
              mfaGenerationId: input.candidate.generationId,
              mfaEnrolledAt: new Date(input.candidate.enrolledAt),
              mfaVerifiedAt: new Date(input.now),
              mfaRequired: true,
              mfaFailedCount: 0,
              mfaLockedUntil: null,
            },
          });
          // Revoke old recovery codes
          await tx.authRecord.updateMany({
            where: {
              userId: input.userId,
              type: AUTH_RECORD_TYPES.mfaRecoveryCode,
              revokedAt: null,
              usedAt: null,
              NOT: {
                metadata: {
                  path: ["mfaGenerationId"],
                  equals: input.candidate.generationId,
                },
              },
            },
            data: { revokedAt: new Date(input.now) },
          });
          await invalidateSessionProofsInTx(
            tx,
            input.userId,
            input.candidate.generationId,
          );
          // Session that proved candidate secret becomes verified on new generation
          await tx.authRecord.update({
            where: { id: input.sessionId },
            data: {
              metadata: {
                ...authRecordMetadata(session.metadata),
                mfaVerifiedAt: new Date(input.now).toISOString(),
                mfaGenerationId: input.candidate.generationId,
                candidateMfaEnrollment: null,
              },
            },
          });
          await this.audit.writeInTx(
            {
              event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled,
              actor_id: input.userId,
              decision: AUDIT_DECISIONS.allow,
              correlationId: input.correlationId,
            },
            this.auditWriter.forTransaction(tx),
          );
          await this.audit.writeInTx(
            {
              event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaVerified,
              actor_id: input.userId,
              decision: AUDIT_DECISIONS.allow,
              correlationId: input.correlationId,
            },
            this.auditWriter.forTransaction(tx),
          );
          return { ok: true };
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
              mfaGenerationId: user.mfaGenerationId,
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

  private async replaceCandidateCodeRecords(
    tx: Prisma.TransactionClient,
    userId: string,
    candidateGenerationId: string,
    batchId: string,
    codes: readonly MfaRecoveryCodeCreateInput[],
    now: number,
    activeGenerationId: string,
  ): Promise<void> {
    await tx.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        revokedAt: null,
        usedAt: null,
        NOT: {
          metadata: {
            path: ["mfaGenerationId"],
            equals: activeGenerationId,
          },
        },
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
        metadata: {
          batchId,
          mfaGenerationId: candidateGenerationId,
          candidate: true,
        },
        createdAt: new Date(now),
      })),
    });
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
    generationId: string,
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
        metadata: { batchId, mfaGenerationId: generationId },
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
