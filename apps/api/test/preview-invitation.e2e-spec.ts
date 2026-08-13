import * as assert from "node:assert/strict";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  ACCEPT_INVITATION_ERROR_CODES,
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
} from "@lcsp/contracts/auth";
import {
  DEVELOPER_ALLOWED_ACTIONS,
  PBAC_ACTIONS,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
  type AuthFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

type PreviewBody = {
  organization: { id: string; name: string };
  scope:
    | {
        type: "assessment";
        assessment: { id: string; name: string };
      }
    | { type: "organization"; assessment: null };
  allowed_actions: string[];
  expires_at: string;
  correlationId: string;
};

describe("Preview Developer Invitation endpoint (e2e) [MW-auth-015]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: AuthFixture;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
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
    await seedPreviewInvitation(prisma, fixture.organizationId);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T06 returns a stable assessment preview without mutation", async () => {
    const before = await prisma.authInvitation.findUniqueOrThrow({
      where: { id: "preview-invite" },
    });
    const usersBefore = await prisma.authUser.count();
    const sessionsBefore = await prisma.authSession.count();
    const membershipsBefore = await prisma.authMembership.count();
    const acceptedAuditsBefore = await prisma.authAuditEvent.count({
      where: {
        eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvitationAccepted,
      },
    });
    const responses = await Promise.all(
      [1, 2].map(() =>
        httpRequest(app)
          .post("/auth/invitations/preview")
          .set("x-correlation-id", "corr-preview")
          .send({ invitation_token: "preview-invite" }),
      ),
    );

    for (const response of responses) {
      assert.equal(response.status, 200);
      const body = successBody<PreviewBody>(response);
      assert.deepEqual(body.organization, {
        id: fixture.organizationId,
        name: "Acme Legal",
      });
      assert.deepEqual(body.scope, {
        type: "assessment",
        assessment: { id: "assessment-preview", name: "Preview Assessment" },
      });
      assert.deepEqual(body.allowed_actions, [PBAC_ACTIONS.scanRead]);
      assert.equal(body.expires_at, before.expiresAt.toISOString());
      assert.equal(body.correlationId, "corr-preview");
    }

    const after = await prisma.authInvitation.findUniqueOrThrow({
      where: { id: "preview-invite" },
    });
    assert.equal(after.state, AUTH_INVITATION_STATES.approved);
    assert.equal(after.expiresAt.toISOString(), before.expiresAt.toISOString());
    assert.equal(await prisma.authUser.count(), usersBefore);
    assert.equal(await prisma.authSession.count(), sessionsBefore);
    assert.equal(await prisma.authMembership.count(), membershipsBefore);
    assert.equal(
      await prisma.authAuditEvent.count({
        where: {
          eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvitationAccepted,
        },
      }),
      acceptedAuditsBefore,
    );
  });

  it("T02 returns organization scope when no assessment is persisted", async () => {
    await prisma.authInvitation.update({
      where: { id: "preview-invite" },
      data: {
        subjectAttributes: {
          role: SUBJECT_ROLES.developer,
          allowed_actions: [PBAC_ACTIONS.scanRead],
        },
      },
    });
    const response = await preview(app, "preview-invite");
    assert.equal(response.status, 200);
    assert.deepEqual(successBody<PreviewBody>(response).scope, {
      type: "organization",
      assessment: null,
    });
  });

  it.each([
    ["unknown", () => Promise.resolve()],
    ["expired", () => updateInvite(prisma, { expiresAt: new Date(0) })],
    [
      "already used",
      () => updateInvite(prisma, { state: AUTH_INVITATION_STATES.consumed }),
    ],
    [
      "non-approved",
      () => updateInvite(prisma, { state: AUTH_INVITATION_STATES.pending }),
    ],
    [
      "malformed scope",
      () =>
        updateInvite(prisma, {
          subjectAttributes: {
            role: SUBJECT_ROLES.developer,
            scope: { assessment_id: "assessment-preview" },
            allowed_actions: [PBAC_ACTIONS.scanRead],
          },
        }),
    ],
  ])(
    "T03 returns one generic error and safe audit for %s",
    async (state, arrange) => {
      await arrange();
      const token = state === "unknown" ? "does-not-exist" : "preview-invite";
      const response = await preview(app, token);
      assert.equal(response.status, 400);
      assert.equal(
        problemCode(response),
        ACCEPT_INVITATION_ERROR_CODES.invitationInvalid,
      );

      const audit = await prisma.authAuditEvent.findFirstOrThrow({
        where: {
          eventType:
            AUTH_AUDIT_EVENT_TYPES.authDeveloperInvitationPreviewDenied,
        },
      });
      assert.equal(audit.actorId, null);
      assert.equal(audit.organizationId, null);
      assert.equal(audit.resourceId, null);
      assert.equal(audit.sessionId, null);
      assert.equal(audit.policyId, null);
      assert.equal(audit.policyVersion, null);
      const serialized = JSON.stringify(audit);
      assert.doesNotMatch(
        serialized,
        /preview-invite|does-not-exist|acme\.test/i,
      );
    },
  );

  it("T04 rejects an assessment from another organization without leaking it", async () => {
    await prisma.assessment.update({
      where: { id: "assessment-preview" },
      data: { organizationId: "other-org", name: "Secret Tenant Assessment" },
    });
    const response = await preview(app, "preview-invite");
    assert.equal(response.status, 400);
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Secret Tenant|other-org/,
    );
  });

  it.each([
    [
      "missing assessment",
      async () =>
        prisma.assessment.delete({ where: { id: "assessment-preview" } }),
    ],
    [
      "wrong role",
      async () =>
        updateInvite(prisma, {
          subjectAttributes: {
            role: SUBJECT_ROLES.manager,
            scope: "assessment-preview",
            allowed_actions: [PBAC_ACTIONS.scanRead],
          },
        }),
    ],
    [
      "empty organization label",
      async () =>
        prisma.authOrganization.update({
          where: { id: fixture.organizationId },
          data: { name: "" },
        }),
    ],
  ])("T05 rejects unverifiable persisted state: %s", async (_case, arrange) => {
    await arrange();
    const response = await preview(app, "preview-invite");
    assert.equal(response.status, 400);
    assert.equal(
      problemCode(response),
      ACCEPT_INVITATION_ERROR_CODES.invitationInvalid,
    );
  });

  it.each([[{}], [null]])(
    "T03 returns INVITATION_INVALID for a missing token body",
    async (payload) => {
      const response = await httpRequest(app)
        .post("/auth/invitations/preview")
        .send(payload ?? undefined);
      assert.equal(response.status, 400);
      assert.equal(
        problemCode(response),
        ACCEPT_INVITATION_ERROR_CODES.invitationInvalid,
      );
    },
  );

  it("T09 never persists the raw token as a caller-supplied correlation ID", async () => {
    const response = await httpRequest(app)
      .post("/auth/invitations/preview")
      .set("x-correlation-id", "missing-secret-token")
      .send({ invitation_token: "missing-secret-token" });
    assert.equal(response.status, 400);
    assert.notEqual(
      (response.body as { problem?: { correlationId?: string } }).problem
        ?.correlationId,
      "missing-secret-token",
    );
    const audit = await prisma.authAuditEvent.findFirstOrThrow({
      where: {
        eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperInvitationPreviewDenied,
      },
    });
    assert.doesNotMatch(JSON.stringify(audit), /missing-secret-token/);
  });

  it("T08 intersects stored, pinned-policy, and Developer actions", async () => {
    await prisma.authInvitation.update({
      where: { id: "preview-invite" },
      data: {
        subjectAttributes: {
          role: SUBJECT_ROLES.developer,
          scope: "assessment-preview",
          allowed_actions: [
            PBAC_ACTIONS.scanRead,
            PBAC_ACTIONS.assessmentCreate,
            "unknown:action",
          ],
        },
      },
    });
    const response = await preview(app, "preview-invite");
    assert.equal(response.status, 200);
    assert.deepEqual(successBody<PreviewBody>(response).allowed_actions, [
      PBAC_ACTIONS.scanRead,
    ]);
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /assessment:create|unknown:action|policy-developer|newdeveloper@/,
    );
  });
});

function preview(app: INestApplication, invitationToken: string) {
  return httpRequest(app)
    .post("/auth/invitations/preview")
    .send({ invitation_token: invitationToken });
}

function updateInvite(
  prisma: PrismaClient,
  data: Parameters<PrismaClient["authInvitation"]["update"]>[0]["data"],
) {
  return prisma.authInvitation.update({
    where: { id: "preview-invite" },
    data,
  });
}

async function seedPreviewInvitation(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  await prisma.assessment.upsert({
    where: { id: "assessment-preview" },
    create: {
      id: "assessment-preview",
      organizationId,
      ownerId: "user-1",
      name: "Preview Assessment",
      status: ASSESSMENT_STATUS_CODES.wizardInProgress,
    },
    update: {
      organizationId,
      ownerId: "user-1",
      name: "Preview Assessment",
      status: ASSESSMENT_STATUS_CODES.wizardInProgress,
    },
  });
  await prisma.authPolicy.create({
    data: {
      id: "policy-developer",
      version: "2026-07-19",
      actions: [PBAC_ACTIONS.scanRead, PBAC_ACTIONS.assessmentCreate],
      subjectRole: SUBJECT_ROLES.developer,
      stateGate: PBAC_STATE_GATES.membershipActive,
      organizationId,
    },
  });
  await prisma.authInvitation.create({
    data: {
      id: "preview-invite",
      email: "newdeveloper@acme.test",
      organizationId,
      state: AUTH_INVITATION_STATES.approved,
      emailVerified: false,
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
      subjectAttributes: {
        role: SUBJECT_ROLES.developer,
        scope: "assessment-preview",
        allowed_actions: [
          PBAC_ACTIONS.scanRead,
          PBAC_ACTIONS.evidenceReadRedacted,
        ],
      },
      policyId: "policy-developer",
      policyVersion: "2026-07-19",
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  assert.ok(DEVELOPER_ALLOWED_ACTIONS.includes(PBAC_ACTIONS.scanRead));
}
