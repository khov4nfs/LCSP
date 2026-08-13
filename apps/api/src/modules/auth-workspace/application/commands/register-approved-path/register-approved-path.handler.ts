import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  AUTH_MEMBERSHIP_STATUSES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import {
  Membership,
  User,
} from "../../../domain/models/auth-workspace.models.ts";
import { hashSecret } from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { RegisterSuccess } from "../../contracts/auth-workspace/register-approved-path.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { DuplicateEmailError } from "../../ports/persistence/user.repository.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { RegisterApprovedPathCommand } from "./register-approved-path.command.ts";

export class RegisterApprovedPathHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: RegisterApprovedPathCommand,
  ): Promise<AuthProblemResult | RegisterSuccess> {
    const { payload, requestMeta } = command;
    const { repositories } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();
    const validationError = this.support.validateRegisterPayload(
      payload,
      correlationId,
    );
    if (validationError) {
      return validationError;
    }

    const inviteId = payload.invite_id as string;
    const password = payload.password as string;
    const invite = await repositories.invitations.findById(inviteId);
    if (!invite || !invite.isApproved()) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.registerFailed,
        actor_id: null,
        organization_id: invite?.organizationId ?? null,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidInviteState,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidInviteState,
        correlationId,
      );
    }

    if (!invite.emailVerified) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.registerFailed,
        actor_id: null,
        organization_id: invite.organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.emailVerificationRequired,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.emailVerificationRequired,
        correlationId,
      );
    }

    if (invite.membershipStatus !== AUTH_MEMBERSHIP_STATUSES.active) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.registerFailed,
        actor_id: null,
        organization_id: invite.organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidInviteState,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidInviteState,
        correlationId,
      );
    }

    const normalizedEmail = this.support.normalizeInvitationEmail(invite);
    if (await repositories.users.findByEmail(normalizedEmail)) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.registerFailed,
        actor_id: null,
        organization_id: invite.organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidInviteState,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidInviteState,
        correlationId,
      );
    }

    const consumed = await repositories.invitations.tryConsume(invite.id);
    if (!consumed) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.registerFailed,
        actor_id: null,
        organization_id: invite.organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidInviteState,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidInviteState,
        correlationId,
      );
    }

    const user = new User({
      email: normalizedEmail,
      passwordHash: hashSecret(password),
      emailVerified: invite.emailVerified,
      failedLoginCount: 0,
      lockUntil: null,
    });
    try {
      await repositories.users.save(user);
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        await this.support.recordAudit(repositories, {
          event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.registerFailed,
          actor_id: null,
          organization_id: invite.organizationId,
          decision: AUDIT_DECISIONS.deny,
          reason_code: AUTH_ERROR_CODES.invalidInviteState,
          correlationId: correlationId,
        });
        return createProblemResult(
          AUTH_ERROR_CODES.invalidInviteState,
          correlationId,
        );
      }
      throw error;
    }

    const membership = new Membership({
      userId: user.id,
      organizationId: invite.organizationId,
      status: invite.membershipStatus,
      subjectAttributes: { ...invite.subjectAttributes },
      policyId: invite.policyId,
      policyVersion: invite.policyVersion,
    });
    await repositories.memberships.save(membership);

    const sessionState = await this.support.createSession(
      repositories,
      user,
      invite.organizationId,
      correlationId,
    );
    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.registerSucceeded,
      actor_id: user.id,
      organization_id: invite.organizationId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    return {
      ok: true,
      correlationId: correlationId,
      session_token: sessionState.token,
      user: this.support.safeUserProjection(
        user,
        invite.organizationId,
        membership,
      ),
    };
  }
}
