import * as crypto from "node:crypto";

import {
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
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
  toPrismaAuthInvitationState,
  toPrismaAuthMembershipStatus,
  toPrismaAuthorizationReasonCode,
  toPrismaAuthPrimaryEmailAddressPolicy,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AuditEventRepository } from "../../application/ports/persistence/audit-event.repository.ts";
import type { AuthorizationDecisionRepository } from "../../application/ports/persistence/authorization-decision.repository.ts";
import type { InvitationRepository } from "../../application/ports/persistence/invitation.repository.ts";
import type { MembershipRepository } from "../../application/ports/persistence/membership.repository.ts";
import type {
  MfaEnrollmentRepository,
  MfaOtpUsedRepository,
  MfaRateLimitRepository,
  MfaRecoveryCodeCreateInput,
  MfaRecoveryCodeRepository,
} from "../../application/ports/persistence/mfa.repository.ts";
import type { OAuthIdentityRepository } from "../../application/ports/persistence/oauth-identity.repository.ts";
import type { OAuthStateRepository } from "../../application/ports/persistence/oauth-state.repository.ts";
import type { OrganizationRepository } from "../../application/ports/persistence/organization.repository.ts";
import type { PolicyRepository } from "../../application/ports/persistence/policy.repository.ts";
import type { RecoveryRequestRepository } from "../../application/ports/persistence/recovery-request.repository.ts";
import type { SessionRepository } from "../../application/ports/persistence/session.repository.ts";
import type { UserRepository } from "../../application/ports/persistence/user.repository.ts";
import { DuplicateEmailError } from "../../application/ports/persistence/user.repository.ts";
import type {
  AuditEvent,
  AuthorizationDecision,
  Invitation,
  Membership,
  MfaEnrollment,
  MfaRateLimit,
  OAuthIdentity,
  OAuthState,
  Organization,
  Policy,
  RecoveryRequest,
  Session,
  User,
} from "../../domain/models/auth-workspace.models.ts";
import {
  dateFromEpochMs,
  dateFromEpochMsRequired,
  mapInvitationRecord,
  mapMembershipRecord,
  mapMfaEnrollmentRecord,
  mapMfaRateLimitRecord,
  mapOAuthIdentityRecord,
  mapOAuthStateRecord,
  mapOrganizationRecord,
  mapPolicyRecord,
  mapRecoveryRequestRecord,
  mapSessionRecord,
  mapUserRecord,
  subjectAttributesToJson,
} from "./prisma-auth-workspace.mappers.ts";

@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(organization: Organization): Promise<void> {
    await this.prisma.authOrganization.upsert({
      where: { id: organization.id },
      create: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        mfaRequired: organization.mfaRequired,
      },
      update: {
        slug: organization.slug,
        name: organization.name,
        mfaRequired: organization.mfaRequired,
      },
    });
  }

  async findById(id: string): Promise<Organization | null> {
    const record = await this.prisma.authOrganization.findUnique({
      where: { id },
    });

    return record ? mapOrganizationRecord(record) : null;
  }
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(user: User): Promise<void> {
    try {
      await this.prisma.authUser.upsert({
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
    const record = await this.prisma.authUser.findUnique({ where: { id } });

    return record ? mapUserRecord(record) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const record = await this.prisma.authUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    return record ? mapUserRecord(record) : null;
  }

  async findByRecoveryEmail(email: string): Promise<User | null> {
    const record = await this.prisma.authUser.findFirst({
      where: { recoveryEmail: email.trim().toLowerCase() },
    });

    return record ? mapUserRecord(record) : null;
  }

  async findByPrimaryEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const record = await this.prisma.authUser.findFirst({
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
export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(membership: Membership): Promise<void> {
    await this.prisma.authMembership.upsert({
      where: { id: membership.id },
      create: {
        id: membership.id,
        userId: membership.userId,
        organizationId: membership.organizationId,
        status: toPrismaAuthMembershipStatus(membership.status),
        subjectAttributes: subjectAttributesToJson(
          membership.subjectAttributes,
        ),
        policyId: membership.policyId,
        policyVersion: membership.policyVersion,
      },
      update: {
        status: toPrismaAuthMembershipStatus(membership.status),
        subjectAttributes: subjectAttributesToJson(
          membership.subjectAttributes,
        ),
        policyId: membership.policyId,
        policyVersion: membership.policyVersion,
      },
    });
  }

  async findByUserAndOrganization(
    userId: string,
    organizationId: string,
  ): Promise<Membership | null> {
    const record = await this.prisma.authMembership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    return record ? mapMembershipRecord(record) : null;
  }

  async findActiveByUserId(userId: string): Promise<Membership[]> {
    const records = await this.prisma.authMembership.findMany({
      where: {
        userId,
        status: toPrismaAuthMembershipStatus(AUTH_MEMBERSHIP_STATUSES.active),
      },
    });

    return records.map(mapMembershipRecord);
  }
}

@Injectable()
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(invitation: Invitation): Promise<void> {
    await this.prisma.authInvitation.upsert({
      where: { id: invitation.id },
      create: {
        id: invitation.id,
        email: invitation.email.toString(),
        organizationId: invitation.organizationId,
        state: toPrismaAuthInvitationState(invitation.state),
        emailVerified: invitation.emailVerified,
        membershipStatus: toPrismaAuthMembershipStatus(
          invitation.membershipStatus,
        ),
        subjectAttributes: subjectAttributesToJson(
          invitation.subjectAttributes,
        ),
        policyId: invitation.policyId,
        policyVersion: invitation.policyVersion,
        expiresAt: dateFromEpochMsRequired(invitation.expiresAt),
      },
      update: {
        email: invitation.email.toString(),
        state: toPrismaAuthInvitationState(invitation.state),
        emailVerified: invitation.emailVerified,
        membershipStatus: toPrismaAuthMembershipStatus(
          invitation.membershipStatus,
        ),
        subjectAttributes: subjectAttributesToJson(
          invitation.subjectAttributes,
        ),
        policyId: invitation.policyId,
        policyVersion: invitation.policyVersion,
        expiresAt: dateFromEpochMsRequired(invitation.expiresAt),
      },
    });
  }

  async findById(id: string): Promise<Invitation | null> {
    const record = await this.prisma.authInvitation.findUnique({
      where: { id },
    });

    return record ? mapInvitationRecord(record) : null;
  }

  async tryConsume(id: string): Promise<boolean> {
    const result = await this.prisma.authInvitation.updateMany({
      where: {
        id,
        state: toPrismaAuthInvitationState(AUTH_INVITATION_STATES.approved),
      },
      data: {
        state: toPrismaAuthInvitationState(AUTH_INVITATION_STATES.consumed),
      },
    });
    return result.count > 0;
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
    await this.prisma.authSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        userId: session.userId,
        organizationId: session.organizationId,
        tokenHash: session.tokenHash,
        tokenFingerprint,
        expiresAt: dateFromEpochMsRequired(session.expiresAt),
        revokedAt: dateFromEpochMs(session.revokedAt),
        mfaVerifiedAt: dateFromEpochMs(session.mfaVerifiedAt),
        sensitiveActionVerifiedAt: dateFromEpochMs(
          session.sensitiveActionVerifiedAt,
        ),
      },
      update: {
        userId: session.userId,
        organizationId: session.organizationId,
        tokenHash: session.tokenHash,
        tokenFingerprint,
        expiresAt: dateFromEpochMsRequired(session.expiresAt),
        revokedAt: dateFromEpochMs(session.revokedAt),
        mfaVerifiedAt: dateFromEpochMs(session.mfaVerifiedAt),
        sensitiveActionVerifiedAt: dateFromEpochMs(
          session.sensitiveActionVerifiedAt,
        ),
      },
    });
  }

  async findByFingerprint(fingerprint: string): Promise<Session | null> {
    const record = await this.prisma.authSession.findUnique({
      where: { tokenFingerprint: fingerprint },
    });

    return record ? mapSessionRecord(record) : null;
  }

  private async resolveFingerprint(session: Session): Promise<string> {
    const existing = await this.prisma.authSession.findUnique({
      where: { id: session.id },
      select: { tokenFingerprint: true },
    });

    if (!existing) {
      throw new Error(
        `Session fingerprint is required for new session ${session.id}`,
      );
    }

    return existing.tokenFingerprint;
  }

  async revokeAllForUser(userId: string, now: number): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date(now) } },
      data: { revokedAt: new Date(now) },
    });
  }
}

@Injectable()
export class PrismaPolicyRepository implements PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdAndVersion(
    id: string,
    version: string,
  ): Promise<Policy | null> {
    const record = await this.prisma.authPolicy.findUnique({
      where: {
        id_version: {
          id,
          version,
        },
      },
    });

    return record ? mapPolicyRecord(record) : null;
  }

  async findLatestByOrganizationAndRole(
    organizationId: string,
    subjectRole: string,
  ): Promise<Policy | null> {
    const record = await this.prisma.authPolicy.findFirst({
      where: { organizationId, subjectRole },
      orderBy: { createdAt: "desc" },
    });

    return record ? mapPolicyRecord(record) : null;
  }
}

@Injectable()
export class PrismaAuditEventRepository implements AuditEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: AuditEvent): Promise<void> {
    const record = normalizeAuditEvent(event);
    await this.prisma.authAuditEvent.create({
      data: record,
    });
  }
}

@Injectable()
export class PrismaAuthorizationDecisionRepository implements AuthorizationDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(decision: AuthorizationDecision): Promise<void> {
    await this.prisma.authDecisionLog.create({
      data: {
        id: crypto.randomUUID(),
        actorId: decision.actor_id ?? null,
        sessionId: decision.session_id ?? null,
        organizationId: decision.organization_id,
        resourceType: toPrismaAuditResourceType(decision.resource_type),
        resourceId: decision.resource_id,
        action: decision.action,
        decision: toPrismaAuthDecision(decision.decision),
        reasonCode: toPrismaAuthorizationReasonCode(decision.reason_code),
        policyId: decision.policy_id,
        policyVersion: decision.policy_version,
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
    const record = await this.prisma.authUserMfa.findUnique({
      where: { userId },
    });
    return record ? mapMfaEnrollmentRecord(record) : null;
  }

  async save(enrollment: MfaEnrollment): Promise<void> {
    await this.prisma.authUserMfa.upsert({
      where: { userId: enrollment.userId },
      create: {
        userId: enrollment.userId,
        encryptedSecret: enrollment.encryptedSecret,
        enrolledAt: new Date(enrollment.enrolledAt),
        verifiedAt: dateFromEpochMs(enrollment.verifiedAt),
      },
      update: {
        encryptedSecret: enrollment.encryptedSecret,
        enrolledAt: new Date(enrollment.enrolledAt),
        verifiedAt: dateFromEpochMs(enrollment.verifiedAt),
      },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.authUserMfa.deleteMany({ where: { userId } });
  }
}

@Injectable()
export class PrismaMfaRateLimitRepository implements MfaRateLimitRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<MfaRateLimit | null> {
    const record = await this.prisma.authMfaRateLimit.findUnique({
      where: { userId },
    });
    return record ? mapMfaRateLimitRecord(record) : null;
  }

  async save(rateLimit: MfaRateLimit): Promise<void> {
    await this.prisma.authMfaRateLimit.upsert({
      where: { userId: rateLimit.userId },
      create: {
        userId: rateLimit.userId,
        failedCount: rateLimit.failedCount,
        lockedUntil: dateFromEpochMs(rateLimit.lockedUntil),
      },
      update: {
        failedCount: rateLimit.failedCount,
        lockedUntil: dateFromEpochMs(rateLimit.lockedUntil),
      },
    });
  }

  async resetByUserId(userId: string): Promise<void> {
    await this.prisma.authMfaRateLimit.deleteMany({
      where: { userId },
    });
  }

  async recordFailedAttempt(
    userId: string,
    now: number,
    limit: number,
    lockWindowMs: number,
  ): Promise<MfaRateLimit> {
    const nowDate = new Date(now);

    // Best-effort reset of a naturally-expired lock before incrementing.
    await this.prisma.authMfaRateLimit.updateMany({
      where: { userId, lockedUntil: { lte: nowDate } },
      data: { failedCount: 0, lockedUntil: null },
    });

    // Atomic increment avoids lost updates under concurrent failed attempts.
    let updated = await this.prisma.authMfaRateLimit.upsert({
      where: { userId },
      create: { userId, failedCount: 1 },
      update: { failedCount: { increment: 1 } },
    });

    if (
      updated.failedCount >= limit &&
      (!updated.lockedUntil || updated.lockedUntil <= nowDate)
    ) {
      updated = await this.prisma.authMfaRateLimit.update({
        where: { userId },
        data: { lockedUntil: new Date(now + lockWindowMs) },
      });
    }

    return mapMfaRateLimitRecord(updated);
  }
}

@Injectable()
export class PrismaMfaOtpUsedRepository implements MfaOtpUsedRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isUsed(userId: string, otpCode: string): Promise<boolean> {
    const record = await this.prisma.authMfaOtpUsed.findUnique({
      where: { userId_otpCode: { userId, otpCode } },
    });
    return record !== null;
  }

  async tryMarkUsed(userId: string, otpCode: string): Promise<boolean> {
    try {
      await this.prisma.authMfaOtpUsed.create({
        data: { userId, otpCode },
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
    await this.prisma.authMfaOtpUsed.deleteMany({
      where: { userId },
    });
  }

  async pruneOlderThan(cutoffMs: number): Promise<void> {
    await this.prisma.authMfaOtpUsed.deleteMany({
      where: { usedAt: { lt: new Date(cutoffMs) } },
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
    const count = await this.prisma.authMfaRecoveryCode.count({
      where: {
        userId,
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
      await tx.authMfaRecoveryCode.updateMany({
        where: { userId, revokedAt: null, usedAt: null },
        data: { revokedAt: nowDate },
      });
      await tx.authMfaRecoveryCode.createMany({
        data: codeRecords.map((record) => ({
          id: record.id,
          userId,
          codeHash: record.codeHash,
          batchId,
          generatedAt: nowDate,
        })),
      });
    });
  }

  async revokeActiveForUser(userId: string, now: number): Promise<void> {
    await this.prisma.authMfaRecoveryCode.updateMany({
      where: { userId, revokedAt: null, usedAt: null },
      data: { revokedAt: new Date(now) },
    });
  }

  async tryConsume(
    userId: string,
    codeHash: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.prisma.authMfaRecoveryCode.updateMany({
      where: {
        userId,
        codeHash,
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
    await this.prisma.authRecoveryRequest.upsert({
      where: { id: request.id },
      create: {
        id: request.id,
        userId: request.userId,
        tokenHash: request.tokenHash,
        tokenFingerprint,
        expiresAt: dateFromEpochMsRequired(request.expiresAt),
        consumedAt: dateFromEpochMs(request.consumedAt),
      },
      update: {
        tokenHash: request.tokenHash,
        tokenFingerprint,
        expiresAt: dateFromEpochMsRequired(request.expiresAt),
        consumedAt: dateFromEpochMs(request.consumedAt),
      },
    });
  }

  async findByFingerprint(
    fingerprint: string,
  ): Promise<RecoveryRequest | null> {
    const record = await this.prisma.authRecoveryRequest.findUnique({
      where: { tokenFingerprint: fingerprint },
    });
    return record ? mapRecoveryRequestRecord(record) : null;
  }

  private async resolveFingerprint(request: RecoveryRequest): Promise<string> {
    const existing = await this.prisma.authRecoveryRequest.findUnique({
      where: { id: request.id },
      select: { tokenFingerprint: true },
    });

    if (!existing) {
      throw new Error(
        `Recovery request fingerprint is required for new request ${request.id}`,
      );
    }

    return existing.tokenFingerprint;
  }
}

@Injectable()
export class PrismaOAuthStateRepository implements OAuthStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(state: OAuthState): Promise<void> {
    await this.prisma.authOAuthState.create({
      data: {
        id: state.id,
        state: state.state,
        nonce: state.nonce,
        provider: state.provider,
        redirectUri: state.redirectUri,
        expiresAt: dateFromEpochMsRequired(state.expiresAt),
        userId: state.userId,
        sessionId: state.sessionId,
      },
    });
  }

  async consumeByState(state: string): Promise<OAuthState | null> {
    try {
      const record = await this.prisma.authOAuthState.delete({
        where: { state },
      });
      return mapOAuthStateRecord(record);
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
    const record = await this.prisma.authOAuthIdentity.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
    });

    return record ? mapOAuthIdentityRecord(record) : null;
  }

  async linkToUser(
    provider: string,
    providerAccountId: string,
    userId: string,
  ): Promise<OAuthIdentity> {
    const record = await this.prisma.authOAuthIdentity.upsert({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      create: {
        id: crypto.randomUUID(),
        provider,
        providerAccountId,
        userId,
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
): Prisma.AuthAuditEventUncheckedCreateInput {
  const payload = event as Prisma.InputJsonValue;
  const rawEventType = authAuditReadString(event, "event_type");
  return {
    id: crypto.randomUUID(),
    eventType: normalizeLegacyAuthAuditEventType(rawEventType),
    actorId: authAuditReadNullableString(event, "actor_id"),
    organizationId: authAuditReadNullableString(event, "organization_id"),
    decision: mapNullableAuthDecision(authAuditReadDecision(event, "decision")),
    reasonCode: authAuditReadNullableString(event, "reason_code"),
    correlationId: authAuditReadString(event, "correlationId"),
    sessionId: authAuditReadNullableString(event, "session_id"),
    policyId: authAuditReadNullableString(event, "policy_id"),
    policyVersion: authAuditReadNullableString(event, "policy_version"),
    payload,
  };
}

function mapNullableAuthDecision(
  decision: ReturnType<typeof authAuditReadDecision>,
) {
  return decision ? toPrismaAuthDecision(decision) : null;
}
