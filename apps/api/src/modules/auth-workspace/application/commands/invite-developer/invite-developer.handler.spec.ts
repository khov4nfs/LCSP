import { describe, expect, it, jest } from "@jest/globals";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
} from "@lcsp/contracts/auth";
import {
  DEVELOPER_ALLOWED_ACTIONS,
  PBAC_ACTIONS,
  PBAC_DECISION,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";

import {
  Invitation,
  Policy,
} from "../../../domain/models/auth-workspace.models.ts";
import type { InvitationRepository } from "../../ports/persistence/invitation.repository.ts";
import type { PolicyRepository } from "../../ports/persistence/policy.repository.ts";
import type { AuthAuditService } from "../../services/auth-workspace/auth-audit.service.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { InviteDeveloperCommand } from "./invite-developer.command.ts";
import { InviteDeveloperHandler } from "./invite-developer.handler.ts";

const DEVELOPER_POLICY = Policy.rehydrate({
  id: "policy-developer",
  version: "2026-06-26",
  actions: DEVELOPER_ALLOWED_ACTIONS,
  subjectRole: SUBJECT_ROLES.developer,
  stateGate: PBAC_STATE_GATES.membershipActive,
  organizationId: "org-1",
});

function buildHandler(input?: {
  assessmentBelongsToOrg?: boolean;
  developerPolicy?: Policy | null;
}) {
  const savedInvitations: Invitation[] = [];
  const auditEvents: Record<string, unknown>[] = [];

  const invitations: InvitationRepository = {
    nextId: () => "invite-1",
    save: jest.fn<InvitationRepository["save"]>((invitation) => {
      savedInvitations.push(invitation);
      return Promise.resolve();
    }),
    findById: () => Promise.resolve(null),
    tryConsume: () => Promise.resolve(false),
  };

  const policies: PolicyRepository = {
    findByIdAndVersion: () => Promise.resolve(null),
    findLatestByOrganizationAndRole: () =>
      Promise.resolve(input?.developerPolicy ?? DEVELOPER_POLICY),
  };

  const authAudit = {
    write: (event: Record<string, unknown>) => {
      auditEvents.push(event);
      return Promise.resolve();
    },
  } as unknown as AuthAuditService;
  const support = new AuthWorkspaceSupportService(authAudit);
  jest.spyOn(support, "now").mockReturnValue(1_700_000_000_000);

  const handler = new InviteDeveloperHandler(
    support,
    {
      invitations,
      policies,
    },
    {
      belongsToOrganization: () =>
        Promise.resolve(input?.assessmentBelongsToOrg ?? true),
      findDisplayByIdAndOrganization: () => Promise.resolve(null),
    },
  );

  return { handler, savedInvitations, auditEvents };
}

describe("InviteDeveloperHandler", () => {
  it("creates an approved scoped Developer invitation with clamped expiry", async () => {
    const { handler, savedInvitations, auditEvents } = buildHandler();

    const result = await handler.execute(
      new InviteDeveloperCommand({
        orgId: "org-1",
        actorId: "manager-1",
        email: "Developer@Example.TEST",
        assessmentId: "assessment-1",
        allowedActions: [
          PBAC_ACTIONS.evidenceReadRedacted,
          "ai-usage-flow:read",
        ],
        expiresInHours: 200,
        correlationId: "corr-1",
      }),
    );

    const invitation = savedInvitations[0];
    expect(result).toEqual({
      invitation_id: invitation.id,
      email: "developer@example.test",
      expires_at: "2023-11-21T22:13:20.000Z",
      allowed_actions: [
        PBAC_ACTIONS.evidenceReadRedacted,
        "ai-usage-flow:read",
      ],
      correlationId: "corr-1",
    });

    expect(invitation.state).toBe(AUTH_INVITATION_STATES.approved);
    expect(invitation.emailVerified).toBe(false);
    expect(invitation.membershipStatus).toBe(AUTH_MEMBERSHIP_STATUSES.active);
    expect(invitation.subjectAttributes).toEqual({
      role: SUBJECT_ROLES.developer,
      scope: "assessment-1",
      allowed_actions: [
        PBAC_ACTIONS.evidenceReadRedacted,
        "ai-usage-flow:read",
      ],
    });
    expect(invitation.policyId).toBe("policy-developer");
    expect(invitation.policyVersion).toBe("2026-06-26");
    expect(invitation.expiresAt).toBe(1_700_000_000_000 + 168 * 60 * 60_000);
    expect(auditEvents[0]).toMatchObject({
      event_type: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvited,
      actor_id: "manager-1",
      organization_id: "org-1",
      decision: PBAC_DECISION.allow,
      correlationId: "corr-1",
    });
  });

  it("rejects Manager-only actions", async () => {
    const { handler, savedInvitations } = buildHandler();

    await expect(
      handler.execute(
        new InviteDeveloperCommand({
          orgId: "org-1",
          actorId: "manager-1",
          email: "developer@example.test",
          allowedActions: ["classification:request"],
          correlationId: "corr-1",
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(savedInvitations).toHaveLength(0);
  });

  it("rejects an assessment outside the Manager organization", async () => {
    const { handler, savedInvitations } = buildHandler({
      assessmentBelongsToOrg: false,
    });

    await expect(
      handler.execute(
        new InviteDeveloperCommand({
          orgId: "org-1",
          actorId: "manager-1",
          email: "developer@example.test",
          assessmentId: "assessment-other-org",
          allowedActions: [PBAC_ACTIONS.evidenceReadRedacted],
          correlationId: "corr-1",
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(savedInvitations).toHaveLength(0);
  });

  it("rejects invalid email with INVALID_EMAIL", async () => {
    const { handler } = buildHandler();

    await expect(
      handler.execute(
        new InviteDeveloperCommand({
          orgId: "org-1",
          actorId: "manager-1",
          email: "not-an-email",
          allowedActions: [PBAC_ACTIONS.evidenceReadRedacted],
          correlationId: "corr-1",
        }),
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
