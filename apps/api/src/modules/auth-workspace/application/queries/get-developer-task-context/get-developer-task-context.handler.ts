import type { AuditResourceType } from "@lcsp/contracts/audit";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_MEMBERSHIP_STATUSES,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import { fromPrismaAuthMembershipStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.ts";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { DeveloperTaskContextResponse } from "../../contracts/auth-workspace/developer-task-context.contract.ts";
import { DEVELOPER_TASK_CONTEXT_ERROR_CODES } from "../../contracts/auth-workspace/developer-task-context.contract.ts";
import type { AssessmentScopeRepository } from "../../ports/persistence/assessment-scope.repository.ts";
import { AuthAuditService } from "../../services/auth-workspace/auth-audit.service.ts";
import {
  invitationAssessmentId,
  projectInvitationScope,
} from "../../services/auth-workspace/invitation-scope-projection.ts";
import { GetDeveloperTaskContextQuery } from "./get-developer-task-context.query.ts";

const CONTEXT_ACTION = "workspace:developer-task:read";

export class GetDeveloperTaskContextHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assessmentScopes: AssessmentScopeRepository,
    private readonly authAudit: AuthAuditService,
  ) {}

  async execute(
    query: GetDeveloperTaskContextQuery,
  ): Promise<DeveloperTaskContextResponse> {
    const { context, correlationId } = query;
    const now = new Date();

    const session = await this.prisma.authSession
      .findUnique({
        where: { id: context.sessionId },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          expiresAt: true,
          revokedAt: true,
          organization: { select: { id: true, name: true } },
        },
      })
      .catch(() => this.deny(query));
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.userId !== context.userId ||
      session.organizationId !== context.organizationId
    ) {
      await this.auditDenied(
        query,
        DEVELOPER_TASK_CONTEXT_ERROR_CODES.sessionInvalid,
      );
      throw problemException(
        DEVELOPER_TASK_CONTEXT_ERROR_CODES.sessionInvalid,
        correlationId,
        { status: HttpStatus.UNAUTHORIZED },
      );
    }

    const membership = await this.prisma.authMembership
      .findUnique({
        where: {
          userId_organizationId: {
            userId: session.userId,
            organizationId: session.organizationId,
          },
        },
        select: {
          status: true,
          subjectAttributes: true,
          policyId: true,
          policyVersion: true,
        },
      })
      .catch(() => this.deny(query));
    if (
      !membership ||
      fromPrismaAuthMembershipStatus(membership.status) !==
        AUTH_MEMBERSHIP_STATUSES.active
    ) {
      return this.deny(query);
    }

    const policy = await this.prisma.authPolicy
      .findUnique({
        where: {
          id_version: {
            id: membership.policyId,
            version: membership.policyVersion,
          },
        },
        select: {
          id: true,
          version: true,
          organizationId: true,
          subjectRole: true,
          stateGate: true,
          actions: true,
        },
      })
      .catch(() =>
        this.deny(query, membership.policyId, membership.policyVersion),
      );
    if (!policy || !isNonEmptyString(session.organization.name)) {
      return this.deny(query, membership.policyId, membership.policyVersion);
    }

    const hasScopeAttribute =
      isRecord(membership.subjectAttributes) &&
      "scope" in membership.subjectAttributes;
    const assessmentId = invitationAssessmentId(membership.subjectAttributes);
    if (hasScopeAttribute && !assessmentId) {
      return this.deny(query, policy.id, policy.version);
    }

    const assessment = assessmentId
      ? await this.assessmentScopes
          .findDisplayByIdAndOrganization(assessmentId, session.organizationId)
          .catch(() => this.deny(query, policy.id, policy.version))
      : null;
    if (assessmentId && !assessment) {
      await this.auditDenied(
        query,
        DEVELOPER_TASK_CONTEXT_ERROR_CODES.taskScopeNotFound,
        policy.id,
        policy.version,
        AUDIT_RESOURCE_TYPES.assessment,
        assessmentId,
      );
      throw problemException(
        DEVELOPER_TASK_CONTEXT_ERROR_CODES.taskScopeNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const projection = projectInvitationScope({
      organizationId: session.organizationId,
      subjectAttributes: membership.subjectAttributes,
      policy,
      assessment,
    });
    if (
      !projection ||
      projection.allowedActions.length === 0 ||
      (assessment !== null && !isNonEmptyString(assessment.name))
    ) {
      return this.deny(query, policy.id, policy.version);
    }

    const resourceType =
      projection.scope.type === "assessment"
        ? AUDIT_RESOURCE_TYPES.assessment
        : AUDIT_RESOURCE_TYPES.authOrganization;
    const resourceId =
      projection.scope.type === "assessment"
        ? projection.scope.assessmentId
        : session.organizationId;
    await this.authAudit.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperTaskContextAllowed,
      actorId: session.userId,
      organizationId: session.organizationId,
      resourceType,
      resourceId,
      decision: AUDIT_DECISIONS.allow,
      correlationId,
      sessionId: session.id,
      policyId: policy.id,
      policyVersion: policy.version,
      payload: {
        action: CONTEXT_ACTION,
        scope_type: projection.scope.type,
        granted_actions: projection.allowedActions,
      },
    });

    return {
      organization: session.organization,
      scope:
        projection.scope.type === "assessment"
          ? {
              type: "assessment",
              assessment: {
                id: projection.scope.assessmentId,
                name: assessment!.name,
              },
            }
          : { type: "organization", assessment: null },
      granted_actions: projection.allowedActions,
      session_expires_at: session.expiresAt.toISOString(),
      correlationId: correlationId,
    };
  }

  private async deny(
    query: GetDeveloperTaskContextQuery,
    policyId: string | null = query.context.policyId,
    policyVersion: string | null = query.context.policyVersion,
  ): Promise<never> {
    await this.auditDenied(
      query,
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.pbacDenied,
      policyId,
      policyVersion,
    );
    throw problemException(
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.pbacDenied,
      query.correlationId,
      { status: HttpStatus.FORBIDDEN },
    );
  }

  private async auditDenied(
    query: GetDeveloperTaskContextQuery,
    reasonCode: string,
    policyId: string | null = query.context.policyId,
    policyVersion: string | null = query.context.policyVersion,
    resourceType: AuditResourceType | null = null,
    resourceId: string | null = null,
  ): Promise<void> {
    await this.authAudit.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperTaskContextDenied,
      actorId: query.context.userId,
      organizationId: query.context.organizationId,
      resourceType,
      resourceId,
      decision: AUDIT_DECISIONS.deny,
      reasonCode,
      correlationId: query.correlationId,
      sessionId: query.context.sessionId,
      policyId,
      policyVersion,
      payload: { action: CONTEXT_ACTION, reason_code: reasonCode },
    });
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
