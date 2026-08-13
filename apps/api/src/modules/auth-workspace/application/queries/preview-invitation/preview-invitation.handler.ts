import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  ACCEPT_INVITATION_ERROR_CODES,
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_INVITATION_STATES,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import { fromPrismaAuthInvitationState } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.ts";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { createCorrelationId } from "../../../infrastructure/security/security.utils.ts";
import type { InvitationPreviewResponse } from "../../contracts/auth-workspace/invitation-preview.contract.ts";
import { AuthAuditService } from "../../services/auth-workspace/auth-audit.service.ts";
import {
  invitationAssessmentId,
  projectInvitationScope,
} from "../../services/auth-workspace/invitation-scope-projection.ts";
import { PreviewInvitationQuery } from "./preview-invitation.query.ts";

export class PreviewInvitationHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAudit: AuthAuditService,
  ) {}

  async execute(
    query: PreviewInvitationQuery,
  ): Promise<InvitationPreviewResponse> {
    const correlationId = safeCorrelationId(
      query.correlationId,
      query.invitationToken,
    );
    if (!isNonEmptyString(query.invitationToken)) {
      return this.deny(correlationId);
    }

    const invitation = await this.prisma.authInvitation.findUnique({
      where: { id: query.invitationToken },
      include: { organization: true, policy: true },
    });
    if (
      !invitation ||
      fromPrismaAuthInvitationState(invitation.state) !==
        AUTH_INVITATION_STATES.approved ||
      invitation.expiresAt <= new Date() ||
      !isNonEmptyString(invitation.organization.name)
    ) {
      return this.deny(correlationId);
    }

    const assessmentId = invitationAssessmentId(invitation.subjectAttributes);
    const assessment = assessmentId
      ? await this.prisma.assessment.findUnique({ where: { id: assessmentId } })
      : null;
    const projection = projectInvitationScope({
      organizationId: invitation.organizationId,
      subjectAttributes: invitation.subjectAttributes,
      policy: invitation.policy,
      assessment,
    });
    if (
      !projection ||
      (projection.scope.type === "assessment" &&
        (!assessment || !isNonEmptyString(assessment.name)))
    ) {
      return this.deny(correlationId);
    }

    return {
      organization: {
        id: invitation.organization.id,
        name: invitation.organization.name,
      },
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
      allowed_actions: projection.allowedActions,
      expires_at: invitation.expiresAt.toISOString(),
      correlationId: correlationId,
    };
  }

  private async deny(correlationId: string): Promise<never> {
    await this.authAudit.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvitationPreviewDenied,
      actorId: null,
      organizationId: null,
      resourceType: null,
      resourceId: null,
      decision: AUDIT_DECISIONS.deny,
      correlationId,
      sessionId: null,
      policyId: null,
      policyVersion: null,
      payload: {
        event_type: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvitationPreviewDenied,
        decision: AUDIT_DECISIONS.deny,
        correlationId: correlationId,
      },
    });
    throw problemException(
      ACCEPT_INVITATION_ERROR_CODES.invitationInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeCorrelationId(
  candidate: unknown,
  invitationToken: unknown,
): string {
  if (
    typeof candidate === "string" &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) &&
    candidate !== invitationToken
  ) {
    return candidate;
  }
  return createCorrelationId();
}
