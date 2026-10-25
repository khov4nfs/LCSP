import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";

import { toPrismaAuthUserRole } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  CreateSignUpRecords,
  SignUpPersistence,
} from "../../application/ports/persistence/sign-up.persistence.ts";
import { AuthAuditService } from "../../application/services/auth/auth-audit.service.ts";
import { lockAccountLifecycle } from "./account-lifecycle.lock.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordLookupKey,
} from "./auth-record.persistence.ts";

@Injectable()
export class PrismaSignUpPersistence implements SignUpPersistence {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuthAuditService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async emailExists(email: string): Promise<boolean> {
    return (
      (await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      })) !== null
    );
  }

  /**
   * Business purpose: Atomically persist an account and its first session with one MFA generation.
   *
   * Business rules:
   * - The session must belong to the new user and carry the exact same generation ID.
   * - The user row must persist the domain-generated ID rather than receiving an unrelated database default.
   * - New sessions carry no MFA or sensitive-action proof; security audit and credentials commit together.
   *
   * Execution flow:
   * 1. Reject inconsistent owner/generation input before opening a database transaction.
   * 2. Serialize sign-up account creation and insert the user's explicit MFA generation.
   * 3. Insert a matching session record and commit its registration audit in the same transaction.
   *
   * Failure cases:
   * - Session ownership/generation mismatch fails closed before creating either record.
   * - Unique email, database, or audit failures roll back all writes.
   *
   * Side effects:
   * - Inserts an account, an initial AuthRecord session and a success audit event atomically.
   */
  async createWithSessionAndAudit(input: CreateSignUpRecords): Promise<void> {
    const { user, session, tokenFingerprint, correlationId } = input;
    if (
      session.userId !== user.id ||
      session.mfaGenerationId !== user.mfaGenerationId
    ) {
      throw new Error(
        "Sign-up session must match the new user's MFA generation",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Password and token hashes are calculated by the handler BEFORE taking
      // this shared lifecycle lock; the transaction only performs DB writes.
      await lockAccountLifecycle(tx);
      await tx.user.create({
        data: {
          id: user.id,
          email: user.email.toString(),
          passwordHash: user.passwordHash,
          emailVerified: user.emailVerified,
          failedLoginCount: user.failedLoginCount,
          lockUntil: user.lockUntil === null ? null : new Date(user.lockUntil),
          displayName: user.displayName,
          role: toPrismaAuthUserRole(user.role),
          mfaRequired: user.mfaRequired,
          mfaGenerationId: user.mfaGenerationId,
        },
      });

      await tx.authRecord.create({
        data: {
          id: session.id,
          userId: session.userId,
          type: AUTH_RECORD_TYPES.session,
          lookupKey: authRecordLookupKey(
            AUTH_RECORD_TYPES.session,
            tokenFingerprint,
          ),
          secretHash: session.tokenHash,
          expiresAt: new Date(session.expiresAt),
          revokedAt: null,
          metadata: {
            tokenFingerprint,
            accessVersion: session.accessVersion,
            mfaGenerationId: session.mfaGenerationId,
            mfaVerifiedAt: null,
            sensitiveActionVerifiedAt: null,
          },
        },
      });

      await this.audit.writeInTx(
        {
          eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpSuccess,
          actorId: user.id,
          resourceType: AUDIT_RESOURCE_TYPES.authSession,
          resourceId: session.id,
          decision: AUDIT_DECISIONS.allow,
          correlationId,
          sessionId: session.id,
          payload: {
            event_type: AUTH_AUDIT_EVENT_TYPES.authSignUpSuccess,
            actor_id: user.id,
            decision: AUDIT_DECISIONS.allow,
            correlationId,
            session_id: session.id,
            role: user.role,
          },
        },
        this.auditWriter.forTransaction(tx),
      );
    });
  }
}
