import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";

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
  ) {}

  async emailExists(email: string): Promise<boolean> {
    return (
      (await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      })) !== null
    );
  }

  async createWithSessionAndAudit(input: CreateSignUpRecords): Promise<void> {
    const { user, session, tokenFingerprint, correlationId } = input;
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
        tx,
      );
    });
  }
}
