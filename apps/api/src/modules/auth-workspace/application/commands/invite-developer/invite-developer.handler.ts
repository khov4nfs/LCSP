import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
  INVITE_DEVELOPER_ERROR_CODES,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import {
  DEVELOPER_SUBJECT_ROLE,
  isDeveloperAllowedAction,
} from "@lcsp/contracts/pbac";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { Invitation } from "../../../domain/models/auth-workspace.models.ts";
import { EmailAddress } from "../../../domain/value-objects/email-address.value-object.ts";
import type { InviteDeveloperResponse } from "../../contracts/auth-workspace/invitation.contract.ts";
import type { AssessmentScopeRepository } from "../../ports/persistence/assessment-scope.repository.ts";
import type { InvitationRepository } from "../../ports/persistence/invitation.repository.ts";
import type { PolicyRepository } from "../../ports/persistence/policy.repository.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { InviteDeveloperCommand } from "./invite-developer.command.ts";

const DEFAULT_EXPIRY_HOURS = 72;
const MAX_EXPIRY_HOURS = 168;
const MILLIS_PER_HOUR = 60 * 60_000;

type InviteDeveloperRepositories = {
  invitations: Pick<InvitationRepository, "nextId" | "save">;
  policies: Pick<PolicyRepository, "findLatestByOrganizationAndRole">;
};

export class InviteDeveloperHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: InviteDeveloperRepositories,
    private readonly assessments: AssessmentScopeRepository,
  ) {}

  async execute(
    command: InviteDeveloperCommand,
  ): Promise<InviteDeveloperResponse> {
    const input = command.input;
    const correlationId =
      input.correlationId ?? this.support.createCorrelationId();

    if (!input.email || !EmailAddress.isValid(input.email)) {
      throw problemException(
        INVITE_DEVELOPER_ERROR_CODES.invalidEmail,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    if (
      !Array.isArray(input.allowedActions) ||
      input.allowedActions.length === 0
    ) {
      throw problemException(
        INVITE_DEVELOPER_ERROR_CODES.invalidActions,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    if (!input.allowedActions.every(isDeveloperAllowedAction)) {
      throw problemException(
        INVITE_DEVELOPER_ERROR_CODES.invalidActions,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    if (input.assessmentId) {
      const owned = await this.assessments.belongsToOrganization(
        input.assessmentId,
        input.orgId,
      );
      if (!owned) {
        throw problemException(
          INVITE_DEVELOPER_ERROR_CODES.assessmentNotOwned,
          correlationId,
          { status: HttpStatus.BAD_REQUEST },
        );
      }
    }

    const developerPolicy =
      await this.repositories.policies.findLatestByOrganizationAndRole(
        input.orgId,
        DEVELOPER_SUBJECT_ROLE,
      );
    if (!developerPolicy) {
      throw problemException(
        INVITE_DEVELOPER_ERROR_CODES.invalidRequest,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const expiresAt =
      this.support.now() + expiryHours(input.expiresInHours) * MILLIS_PER_HOUR;
    const email = EmailAddress.create(input.email).toString();
    const allowedActions = [...input.allowedActions];
    const invitation = new Invitation({
      email,
      organizationId: input.orgId,
      state: AUTH_INVITATION_STATES.approved,
      emailVerified: false,
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
      subjectAttributes: {
        role: DEVELOPER_SUBJECT_ROLE,
        ...(input.assessmentId ? { scope: input.assessmentId } : {}),
        allowed_actions: allowedActions,
      },
      policyId: developerPolicy.id,
      policyVersion: developerPolicy.version,
      expiresAt,
    });

    await this.repositories.invitations.save(invitation);
    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvited,
      actor_id: input.actorId,
      organization_id: input.orgId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      policy_id: developerPolicy.id,
      policy_version: developerPolicy.version,
      invitee_email: email,
      invitation_id: invitation.id,
      allowed_actions: allowedActions,
      scope: input.assessmentId ?? null,
      expires_at: new Date(expiresAt).toISOString(),
    });

    return {
      invitation_id: invitation.id,
      email,
      expires_at: new Date(expiresAt).toISOString(),
      allowed_actions: allowedActions,
      correlationId: correlationId,
    };
  }
}

function expiryHours(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_EXPIRY_HOURS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_EXPIRY_HOURS;
  }
  return Math.min(Math.floor(value), MAX_EXPIRY_HOURS);
}
