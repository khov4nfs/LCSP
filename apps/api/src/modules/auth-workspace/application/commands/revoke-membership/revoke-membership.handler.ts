import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_MEMBERSHIP_STATUSES,
  REVOKE_MEMBERSHIP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import { HttpStatus } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import {
  fromPrismaAuthMembershipStatus,
  toPrismaAuthMembershipStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.ts";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { createCorrelationId } from "../../../infrastructure/security/security.utils.ts";
import type { RevokeMembershipResponse } from "../../contracts/auth-workspace/revoke-membership.contract.ts";
import { AuthAuditService } from "../../services/auth-workspace/auth-audit.service.ts";
import { RevokeMembershipCommand } from "./revoke-membership.command.ts";

export class RevokeMembershipHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAudit: AuthAuditService,
  ) {}

  async execute(
    command: RevokeMembershipCommand,
  ): Promise<RevokeMembershipResponse> {
    const { orgId, actorId, targetUserId } = command.input;
    const correlationId = command.input.correlationId ?? createCorrelationId();

    if (actorId === targetUserId) {
      throw problemException(
        REVOKE_MEMBERSHIP_ERROR_CODES.cannotSelfRevoke,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const membership = await this.prisma.authMembership.findUnique({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId: orgId,
        },
      },
    });

    if (
      !membership ||
      fromPrismaAuthMembershipStatus(membership.status) !==
        AUTH_MEMBERSHIP_STATUSES.active ||
      roleFrom(membership.subjectAttributes) !== SUBJECT_ROLES.developer
    ) {
      throw problemException(
        REVOKE_MEMBERSHIP_ERROR_CODES.membershipNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const revokedAt = new Date();
    const affectedSessions = await this.prisma.$transaction(async (tx) => {
      const revokedMembership = await tx.authMembership.updateMany({
        where: {
          id: membership.id,
          status: toPrismaAuthMembershipStatus(AUTH_MEMBERSHIP_STATUSES.active),
        },
        data: {
          status: toPrismaAuthMembershipStatus(
            AUTH_MEMBERSHIP_STATUSES.revoked,
          ),
          revokedAt,
        },
      });
      if (revokedMembership.count !== 1) {
        throw problemException(
          REVOKE_MEMBERSHIP_ERROR_CODES.membershipNotFound,
          correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      const revokedSessions = await tx.authSession.updateMany({
        where: {
          userId: targetUserId,
          organizationId: orgId,
          revokedAt: null,
          expiresAt: { gt: revokedAt },
        },
        data: { revokedAt },
      });

      await this.authAudit.writeInTx(
        {
          eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperRevoked,
          actorId,
          organizationId: orgId,
          resourceType: AUDIT_RESOURCE_TYPES.authMembership,
          resourceId: membership.id,
          decision: AUDIT_DECISIONS.allow,
          correlationId,
          policyId: membership.policyId,
          policyVersion: membership.policyVersion,
          payload: {
            event_type: AUTH_AUDIT_EVENT_TYPES.authDeveloperRevoked,
            actor_id: actorId,
            organization_id: orgId,
            decision: AUDIT_DECISIONS.allow,
            correlationId: correlationId,
            target_user_id: targetUserId,
            affected_sessions: revokedSessions.count,
            membership_id: membership.id,
            policy_id: membership.policyId,
            policy_version: membership.policyVersion,
          },
        },
        tx,
      );

      return revokedSessions.count;
    });

    return {
      revoked: true,
      affected_sessions: affectedSessions,
      correlationId: correlationId,
    };
  }
}

function roleFrom(value: Prisma.JsonValue): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const role = value.role;
  return typeof role === "string" ? role : null;
}
