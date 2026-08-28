import * as crypto from "node:crypto";

import {
  authAuditReadDecision,
  authAuditReadNullableString,
  authAuditReadString,
  normalizeLegacyAuthAuditEventType,
} from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import {
  toPrismaAuditResourceType,
  toPrismaAuthBackupEmailPolicy,
  toPrismaAuthDecision,
  toPrismaAuthUserRole,
  toPrismaAuthPrimaryEmailAddressPolicy,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AuditEventRepository } from "../../application/ports/persistence/audit-event.repository.ts";
import type { AuthorizationDecisionRepository } from "../../application/ports/persistence/authorization-decision.repository.ts";
import type {
  MfaEnrollmentRepository,
  MfaOtpUsedRepository,
  MfaRateLimitRepository,
  MfaRecoveryCodeCreateInput,
  MfaRecoveryCodeRepository,
} from "../../application/ports/persistence/mfa.repository.ts";
import type { OAuthIdentityRepository } from "../../application/ports/persistence/oauth-identity.repository.ts";
import type { OAuthStateRepository } from "../../application/ports/persistence/oauth-state.repository.ts";
import type { RecoveryRequestRepository } from "../../application/ports/persistence/recovery-request.repository.ts";
import type { SessionRepository } from "../../application/ports/persistence/session.repository.ts";
import type { UserRepository } from "../../application/ports/persistence/user.repository.ts";
import { DuplicateEmailError } from "../../application/ports/persistence/user.repository.ts";
import type {
  AuditEvent,
  AuthorizationDecision,
  MfaEnrollment,
  MfaRateLimit,
  OAuthIdentity,
  OAuthState,
  RecoveryRequest,
  Session,
  User,
} from "../../domain/models/auth-workspace.models.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordDateMetadata,
  authRecordLookupKey,
} from "./auth-record.persistence.ts";
import {
  dateFromEpochMs,
  dateFromEpochMsRequired,
  mapMfaEnrollmentRecord,
  mapMfaRateLimitRecord,
  mapOAuthIdentityRecord,
  mapOAuthStateRecord,
  mapRecoveryRequestRecord,
  mapSessionRecord,
  mapUserRecord,
} from "./prisma-auth-workspace.mappers.ts";

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(user: User): Promise<void> {
    try {
      await this.prisma.user.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          email: user.email.toString(),
          passwordHash: user.passwordHash,
          emailVerified: user.emailVerified,
          failedLoginCount: user.failedLoginCount,
          lockUntil: dateFromEpochMs(user.lockUntil),
          displayName: user.displayName,
          recoveryEmail: user.recoveryEmail,
          primaryEmailAddressPolicy: toPrismaAuthPrimaryEmailAddressPolicy(
            user.primaryEmailAddressPolicy,
          ),
          backupEmailPolicy: toPrismaAuthBackupEmailPolicy(
            user.backupEmailPolicy,
          ),
          role: toPrismaAuthUserRole(user.role),
          mfaRequired: user.mfaRequired,
        },
        update: {
          email: user.email.toString(),
          passwordHash: user.passwordHash,
          emailVerified: user.emailVerified,
          failedLoginCount: user.failedLoginCount,
          lockUntil: dateFromEpochMs(user.lockUntil),
          displayName: user.displayName,
          recoveryEmail: user.recoveryEmail,
          primaryEmailAddressPolicy: toPrismaAuthPrimaryEmailAddressPolicy(
            user.primaryEmailAddressPolicy,
          ),
          backupEmailPolicy: toPrismaAuthBackupEmailPolicy(
            user.backupEmailPolicy,
          ),
          role: toPrismaAuthUserRole(user.role),
          mfaRequired: user.mfaRequired,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new DuplicateEmailError(user.email.toString());
      }
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });
    return record ? mapUserRecord(record) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    return record ? mapUserRecord(record) : null;
  }

  async findByRecoveryEmail(email: string): Promise<User | null> {
    const record = await this.prisma.user.findFirst({
      where: { recoveryEmail: email.trim().toLowerCase() },
    });
    return record ? mapUserRecord(record) : null;
  }

  async findByPrimaryEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const record = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          {
            recoveryEmail: normalizedEmail,
            primaryEmailAddressPolicy: "RECOVERY_EMAIL",
          },
        ],
      },
    });
    return record ? mapUserRecord(record) : null;
  }
}

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(session: Session, fingerprint?: string): Promise<void> {
    const tokenFingerprint =
      fingerprint ?? (await this.resolveFingerprint(session));
    const metadata = {
      tokenFingerprint,
      mfaVerifiedAt: authRecordDateMetadata(session.mfaVerifiedAt),
      sensitiveActionVerifiedAt: authRecordDateMetadata(
        session.sensitiveActionVerifiedAt,
      ),
    } satisfies Prisma.InputJsonObject;

    await this.prisma.authRecord.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        userId: session.userId,
        type: AUTH_RECORD_TYPES.session,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.session,
          tokenFingerprint,
        ),
        secretHash: session.tokenHash,
        expiresAt: dateFromEpochMsRequired(session.expiresAt),
        revokedAt: dateFromEpochMs(session.revokedAt),
        metadata,
      },
      update: {
        userId: session.userId,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.session,
          tokenFingerprint,
        ),
        secretHash: session.tokenHash,
        expiresAt: dateFromEpochMsRequired(session.expiresAt),
        revokedAt: dateFromEpochMs(session.revokedAt),
        metadata,
      },
    });
  }

  async findByFingerprint(fingerprint: string): Promise<Session | null> {
    const record = await this.prisma.authRecord.findUnique({
      where: {
        lookupKey: authRecordLookupKey(AUTH_RECORD_TYPES.session, fingerprint),
      },
    });
    return record?.type === AUTH_RECORD_TYPES.session
      ? mapSessionRecord(record)
      : null;
  }

  private async resolveFingerprint(session: Session): Promise<string> {
    const existing = await this.prisma.authRecord.findUnique({
      where: { id: session.id },
      select: { type: true, lookupKey: true },
    });
    if (!existing || existing.type !== AUTH_RECORD_TYPES.session) {
      throw new Error(
        `Session fingerprint is required for new session ${session.id}`,
      );
    }
    return existing.lookupKey.slice(`${AUTH_RECORD_TYPES.session}:`.length);
  }

  async revokeAllForUser(userId: string, now: number): Promise<void> {
    await this.prisma.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.session,
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
      },
      data: { revokedAt: new Date(now) },
    });
  }
}

@Injectable()
export class PrismaAuditEventRepository implements AuditEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: AuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({ data: normalizeAuditEvent(event) });
  }
}

@Injectable()
export class PrismaAuthorizationDecisionRepository implements AuthorizationDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(decision: AuthorizationDecision): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        eventType: "AUTHORIZATION_DECISION",
        actorId: decision.actor_id ?? null,
        sessionId: decision.session_id ?? null,
        resourceType: toPrismaAuditResourceType(decision.resource_type),
        resourceId: decision.resource_id,
        decision: toPrismaAuthDecision(decision.decision),
        reasonCode: decision.reason_code,
        correlationId: decision.correlationId,
        payload: decision,
      },
    });
  }
}

@Injectable()
export class PrismaMfaEnrollmentRepository implements MfaEnrollmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<MfaEnrollment | null> {
    const record = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!record?.mfaEncryptedSecret || !record.mfaEnrolledAt) {
      return null;
    }
    return mapMfaEnrollmentRecord(record);
  }

  async save(enrollment: MfaEnrollment): Promise<void> {
    await this.prisma.user.update({
      where: { id: enrollment.userId },
      data: {
        mfaEncryptedSecret: enrollment.encryptedSecret,
        mfaEnrolledAt: new Date(enrollment.enrolledAt),
        mfaVerifiedAt: dateFromEpochMs(enrollment.verifiedAt),
      },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: {
        mfaEncryptedSecret: null,
        mfaEnrolledAt: null,
        mfaVerifiedAt: null,
      },
    });
  }
}

@Injectable()
export class PrismaMfaRateLimitRepository implements MfaRateLimitRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<MfaRateLimit | null> {
    const record = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!record || (record.mfaFailedCount === 0 && !record.mfaLockedUntil)) {
      return null;
    }
    return mapMfaRateLimitRecord(record);
  }

  async save(rateLimit: MfaRateLimit): Promise<void> {
    await this.prisma.user.update({
      where: { id: rateLimit.userId },
      data: {
        mfaFailedCount: rateLimit.failedCount,
        mfaLockedUntil: dateFromEpochMs(rateLimit.lockedUntil),
      },
    });
  }

  async resetByUserId(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { mfaFailedCount: 0, mfaLockedUntil: null },
    });
  }

  async recordFailedAttempt(
    userId: string,
    now: number,
    limit: number,
    lockWindowMs: number,
  ): Promise<MfaRateLimit> {
    const nowDate = new Date(now);
    await this.prisma.user.updateMany({
      where: { id: userId, mfaLockedUntil: { lte: nowDate } },
      data: { mfaFailedCount: 0, mfaLockedUntil: null },
    });

    let updated = await this.prisma.user.update({
      where: { id: userId },
      data: { mfaFailedCount: { increment: 1 } },
    });

    if (
      updated.mfaFailedCount >= limit &&
      (!updated.mfaLockedUntil || updated.mfaLockedUntil <= nowDate)
    ) {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data: { mfaLockedUntil: new Date(now + lockWindowMs) },
      });
    }
    return mapMfaRateLimitRecord(updated);
  }
}

@Injectable()
export class PrismaMfaOtpUsedRepository implements MfaOtpUsedRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isUsed(userId: string, otpCode: string): Promise<boolean> {
    return (
      (await this.prisma.authRecord.findUnique({
        where: {
          lookupKey: authRecordLookupKey(
            AUTH_RECORD_TYPES.mfaOtpUse,
            userId,
            otpCode,
          ),
        },
        select: { id: true },
      })) !== null
    );
  }

  async tryMarkUsed(userId: string, otpCode: string): Promise<boolean> {
    try {
      await this.prisma.authRecord.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          type: AUTH_RECORD_TYPES.mfaOtpUse,
          lookupKey: authRecordLookupKey(
            AUTH_RECORD_TYPES.mfaOtpUse,
            userId,
            otpCode,
          ),
          usedAt: new Date(),
          metadata: { otpCode },
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.authRecord.deleteMany({
      where: { userId, type: AUTH_RECORD_TYPES.mfaOtpUse },
    });
  }

  async pruneOlderThan(cutoffMs: number): Promise<void> {
    await this.prisma.authRecord.deleteMany({
      where: {
        type: AUTH_RECORD_TYPES.mfaOtpUse,
        usedAt: { lt: new Date(cutoffMs) },
      },
    });
  }
}

@Injectable()
export class PrismaMfaRecoveryCodeRepository implements MfaRecoveryCodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  nextBatchId(): string {
    return crypto.randomUUID();
  }

  async hasActiveForUser(userId: string): Promise<boolean> {
    const count = await this.prisma.authRecord.count({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        usedAt: null,
        revokedAt: null,
      },
    });
    return count > 0;
  }

  async replaceForUser(
    userId: string,
    codeRecords: readonly MfaRecoveryCodeCreateInput[],
    batchId: string,
    now: number,
  ): Promise<void> {
    const nowDate = new Date(now);
    await this.prisma.$transaction(async (tx) => {
      await tx.authRecord.updateMany({
        where: {
          userId,
          type: AUTH_RECORD_TYPES.mfaRecoveryCode,
          revokedAt: null,
          usedAt: null,
        },
        data: { revokedAt: nowDate },
      });
      await tx.authRecord.createMany({
        data: codeRecords.map((record) => ({
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
          createdAt: nowDate,
        })),
      });
    });
  }

  async revokeActiveForUser(userId: string, now: number): Promise<void> {
    await this.prisma.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        revokedAt: null,
        usedAt: null,
      },
      data: { revokedAt: new Date(now) },
    });
  }

  async tryConsume(
    userId: string,
    codeHash: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.prisma.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.mfaRecoveryCode,
          userId,
          codeHash,
        ),
        usedAt: null,
        revokedAt: null,
      },
      data: { usedAt: new Date(now) },
    });
    return result.count === 1;
  }
}

@Injectable()
export class PrismaRecoveryRequestRepository implements RecoveryRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(request: RecoveryRequest, fingerprint?: string): Promise<void> {
    const tokenFingerprint =
      fingerprint ?? (await this.resolveFingerprint(request));
    await this.prisma.authRecord.upsert({
      where: { id: request.id },
      create: {
        id: request.id,
        userId: request.userId,
        type: AUTH_RECORD_TYPES.recoveryRequest,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.recoveryRequest,
          tokenFingerprint,
        ),
        secretHash: request.tokenHash,
        expiresAt: dateFromEpochMsRequired(request.expiresAt),
        usedAt: dateFromEpochMs(request.consumedAt),
        metadata: { tokenFingerprint },
      },
      update: {
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.recoveryRequest,
          tokenFingerprint,
        ),
        secretHash: request.tokenHash,
        expiresAt: dateFromEpochMsRequired(request.expiresAt),
        usedAt: dateFromEpochMs(request.consumedAt),
        metadata: { tokenFingerprint },
      },
    });
  }

  async findByFingerprint(
    fingerprint: string,
  ): Promise<RecoveryRequest | null> {
    const record = await this.prisma.authRecord.findUnique({
      where: {
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.recoveryRequest,
          fingerprint,
        ),
      },
    });
    return record?.type === AUTH_RECORD_TYPES.recoveryRequest
      ? mapRecoveryRequestRecord(record)
      : null;
  }

  private async resolveFingerprint(request: RecoveryRequest): Promise<string> {
    const existing = await this.prisma.authRecord.findUnique({
      where: { id: request.id },
      select: { type: true, lookupKey: true },
    });
    if (!existing || existing.type !== AUTH_RECORD_TYPES.recoveryRequest) {
      throw new Error(
        `Recovery request fingerprint is required for new request ${request.id}`,
      );
    }
    return existing.lookupKey.slice(
      `${AUTH_RECORD_TYPES.recoveryRequest}:`.length,
    );
  }
}

@Injectable()
export class PrismaOAuthStateRepository implements OAuthStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(state: OAuthState): Promise<void> {
    await this.prisma.authRecord.create({
      data: {
        id: state.id,
        userId: state.userId,
        type: AUTH_RECORD_TYPES.oauthState,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.oauthState,
          state.state,
        ),
        expiresAt: dateFromEpochMsRequired(state.expiresAt),
        metadata: {
          state: state.state,
          nonce: state.nonce,
          provider: state.provider,
          redirectUri: state.redirectUri,
          sessionId: state.sessionId,
        },
      },
    });
  }

  async consumeByState(state: string): Promise<OAuthState | null> {
    try {
      const record = await this.prisma.authRecord.delete({
        where: {
          lookupKey: authRecordLookupKey(AUTH_RECORD_TYPES.oauthState, state),
        },
      });
      return record.type === AUTH_RECORD_TYPES.oauthState
        ? mapOAuthStateRecord(record)
        : null;
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

@Injectable()
export class PrismaOAuthIdentityRepository implements OAuthIdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProviderAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<OAuthIdentity | null> {
    const record = await this.prisma.authRecord.findUnique({
      where: {
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.oauthIdentity,
          provider,
          providerAccountId,
        ),
      },
    });
    return record?.type === AUTH_RECORD_TYPES.oauthIdentity
      ? mapOAuthIdentityRecord(record)
      : null;
  }

  async linkToUser(
    provider: string,
    providerAccountId: string,
    userId: string,
  ): Promise<OAuthIdentity> {
    const lookupKey = authRecordLookupKey(
      AUTH_RECORD_TYPES.oauthIdentity,
      provider,
      providerAccountId,
    );
    const record = await this.prisma.authRecord.upsert({
      where: { lookupKey },
      create: {
        id: crypto.randomUUID(),
        userId,
        type: AUTH_RECORD_TYPES.oauthIdentity,
        lookupKey,
        metadata: { provider, providerAccountId },
      },
      update: {},
    });
    return mapOAuthIdentityRecord(record);
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

function isRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

function normalizeAuditEvent(
  event: AuditEvent,
): Prisma.AuditEventUncheckedCreateInput {
  const payload = event as Prisma.InputJsonValue;
  const rawEventType = authAuditReadString(event, "event_type");
  return {
    id: crypto.randomUUID(),
    eventType: normalizeLegacyAuthAuditEventType(rawEventType),
    actorId: authAuditReadNullableString(event, "actor_id"),
    decision: mapNullableAuthDecision(authAuditReadDecision(event, "decision")),
    reasonCode: authAuditReadNullableString(event, "reason_code"),
    correlationId: authAuditReadString(event, "correlationId"),
    sessionId: authAuditReadNullableString(event, "session_id"),
    payload,
  };
}

function mapNullableAuthDecision(
  decision: ReturnType<typeof authAuditReadDecision>,
) {
  return decision ? toPrismaAuthDecision(decision) : null;
}
