import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
  INVITE_DEVELOPER_ERROR_CODES,
} from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_DECISION,
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { DEVELOPER_ALLOWED_ACTIONS } from "@lcsp/contracts/pbac";
import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  type AuthFixture,
} from "./support/auth-workspace-test-helpers.js";

type InviteDeveloperBody = {
  invitation_id: string;
  email: string;
  correlationId: string;
  allowed_actions: string[];
};

describe("Invite Developer endpoint (e2e) [MW-auth-010]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: AuthFixture;
  let managerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();

    prisma = new PrismaClient({
      adapter: new PrismaPg(TEST_DATABASE_URL),
    });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetAuthWorkspaceDatabase(prisma);
    fixture = await seedAuthWorkspaceFixture(prisma);
    await seedDeveloperPolicy(prisma, fixture.organizationId);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: fixture.organizationId,
    });
    managerToken = successBody<SignInSuccess>(signIn).session_token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T07 creates a scoped Developer invitation for an org-owned assessment", async () => {
    await grantManagerInviteAction(prisma);
    await seedAssessment(
      prisma,
      fixture.organizationId,
      fixture.approvedUser.id,
    );

    const result = await httpRequest(app)
      .post(`/organizations/${fixture.organizationId}/invitations`)
      .set("Authorization", `Bearer ${managerToken}`)
      .set("x-correlation-id", "corr-invite-1")
      .send({
        email: "Developer@Example.TEST",
        assessment_id: "assessment-1",
        allowed_actions: [
          PBAC_ACTIONS.evidenceReadRedacted,
          "ai-usage-flow:read",
        ],
        expires_in_hours: 72,
      });

    assert.equal(result.status, 201);
    const body = successBody<InviteDeveloperBody>(result);
    assert.equal(body.email, "developer@example.test");
    assert.equal(body.correlationId, "corr-invite-1");
    assert.deepEqual(body.allowed_actions, [
      PBAC_ACTIONS.evidenceReadRedacted,
      "ai-usage-flow:read",
    ]);

    const invitation = await prisma.authInvitation.findUniqueOrThrow({
      where: { id: body.invitation_id },
    });
    assert.equal(invitation.state, AUTH_INVITATION_STATES.approved);
    assert.equal(invitation.emailVerified, false);
    assert.equal(invitation.membershipStatus, AUTH_MEMBERSHIP_STATUSES.active);
    assert.equal(invitation.policyId, "policy-developer");
    assert.match(JSON.stringify(invitation.subjectAttributes), /Developer/);
    assert.doesNotMatch(
      JSON.stringify(invitation.subjectAttributes),
      /classification:request|final-report:generate|organization:manage/,
    );

    const audit = await prisma.authAuditEvent.findFirstOrThrow({
      where: { eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvited },
    });
    assert.equal(audit.correlationId, "corr-invite-1");

    const decision = await prisma.authDecisionLog.findFirstOrThrow({
      where: {
        correlationId: "corr-invite-1",
        action: PBAC_ACTIONS.inviteDeveloper,
        decision: PBAC_DECISION.allow,
      },
    });
    assert.equal(decision.resourceType, AUDIT_RESOURCE_TYPES.httpRoute);
  });

  it("T02 returns PBAC_DENIED and writes AuthDecisionLog when Manager lacks invite action", async () => {
    const result = await httpRequest(app)
      .post(`/organizations/${fixture.organizationId}/invitations`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        email: "developer@example.test",
        allowed_actions: [PBAC_ACTIONS.evidenceReadRedacted],
      });

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), PBAC_REASON_CODE.denied);

    const decision = await prisma.authDecisionLog.findFirstOrThrow({
      where: {
        action: PBAC_ACTIONS.inviteDeveloper,
        decision: PBAC_DECISION.deny,
      },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(decision.resourceType, AUDIT_RESOURCE_TYPES.httpRoute);
  });

  it("T03 rejects Manager-only actions", async () => {
    await grantManagerInviteAction(prisma);

    const result = await httpRequest(app)
      .post(`/organizations/${fixture.organizationId}/invitations`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        email: "developer@example.test",
        allowed_actions: [PBAC_ACTIONS.finalReportGenerate],
      });

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      INVITE_DEVELOPER_ERROR_CODES.invalidActions,
    );
  });

  it("T04 rejects assessment scope outside the organization", async () => {
    await grantManagerInviteAction(prisma);
    await seedAssessment(prisma, "org-other", fixture.approvedUser.id);

    const result = await httpRequest(app)
      .post(`/organizations/${fixture.organizationId}/invitations`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        email: "developer@example.test",
        assessment_id: "assessment-1",
        allowed_actions: [PBAC_ACTIONS.evidenceReadRedacted],
      });

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      INVITE_DEVELOPER_ERROR_CODES.assessmentNotOwned,
    );
  });

  it("T05 rejects invalid email", async () => {
    await grantManagerInviteAction(prisma);

    const result = await httpRequest(app)
      .post(`/organizations/${fixture.organizationId}/invitations`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        email: "not-an-email",
        allowed_actions: [PBAC_ACTIONS.evidenceReadRedacted],
      });

    assert.equal(result.status, 422);
    assert.equal(
      problemCode(result),
      INVITE_DEVELOPER_ERROR_CODES.invalidEmail,
    );
  });
});

async function seedDeveloperPolicy(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  await prisma.authPolicy.create({
    data: {
      id: "policy-developer",
      version: "2026-06-26",
      actions: DEVELOPER_ALLOWED_ACTIONS,
      subjectRole: SUBJECT_ROLES.developer,
      stateGate: PBAC_STATE_GATES.membershipActive,
      organizationId,
    },
  });
}

async function grantManagerInviteAction(prisma: PrismaClient): Promise<void> {
  await prisma.authPolicy.update({
    where: {
      id_version: {
        id: "policy-manager-workspace",
        version: "2026-06-26",
      },
    },
    data: { actions: { push: PBAC_ACTIONS.inviteDeveloper } },
  });
}

async function seedAssessment(
  prisma: PrismaClient,
  organizationId: string,
  ownerId: string,
): Promise<void> {
  await prisma.assessment.upsert({
    where: { id: "assessment-1" },
    create: {
      id: "assessment-1",
      organizationId,
      ownerId,
      name: "Assessment 1",
      description: null,
      status: ASSESSMENT_STATUS_CODES.wizardInProgress,
    },
    update: {
      organizationId,
      ownerId,
      name: "Assessment 1",
      description: null,
      status: ASSESSMENT_STATUS_CODES.wizardInProgress,
    },
  });
}
