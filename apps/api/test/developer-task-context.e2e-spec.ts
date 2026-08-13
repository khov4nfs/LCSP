import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_MEMBERSHIP_STATUSES,
} from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import * as assert from "node:assert/strict";

import { AppModule } from "../src/app.module.js";
import {
  DEVELOPER_TASK_CONTEXT_ERROR_CODES,
  type DeveloperTaskContextResponse,
} from "../src/modules/auth-workspace/application/contracts/auth-workspace/developer-task-context.contract.js";
import {
  fingerprintToken,
  hashSecret,
} from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const TOKEN = "developer-task-session-token";
const USER_ID = "developer-task-user";
const SESSION_ID = "developer-task-session";
const POLICY_ID = "developer-task-policy";
const POLICY_VERSION = "1";
const ASSESSMENT_ID = "developer-task-assessment";

describe("Developer scoped workspace context endpoint (e2e) [MW-auth-016]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let organizationId: string;

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
    await prisma.assessment.deleteMany({
      where: { id: { in: [ASSESSMENT_ID, "foreign-assessment"] } },
    });
    const fixture = await seedAuthWorkspaceFixture(prisma);
    organizationId = fixture.organizationId;
    await seedDeveloper(prisma, organizationId);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T07/T09 returns exact assessment context and only current Developer actions", async () => {
    const response = await getContext(app, "corr-developer-task");
    const body = successBody<DeveloperTaskContextResponse>(response);

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      organization: { id: organizationId, name: "Acme Legal" },
      scope: {
        type: "assessment",
        assessment: { id: ASSESSMENT_ID, name: "Developer Assessment" },
      },
      granted_actions: [PBAC_ACTIONS.scanRead],
      session_expires_at: body.session_expires_at,
      correlationId: "corr-developer-task",
    });
    assert.ok(Date.parse(body.session_expires_at));
    assert.deepEqual(Object.keys(body).sort(), [
      "correlationId",
      "granted_actions",
      "organization",
      "scope",
      "session_expires_at",
    ]);
    assert.doesNotMatch(
      JSON.stringify(body),
      /findings|repository|file_path|line_number|policy|subjectAttributes|token/i,
    );

    const audit = await prisma.authAuditEvent.findFirstOrThrow({
      where: {
        eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperTaskContextAllowed,
      },
    });
    assert.equal(audit.actorId, USER_ID);
    assert.equal(audit.organizationId, organizationId);
    assert.equal(audit.resourceId, ASSESSMENT_ID);
    assert.equal(audit.decision, AUDIT_DECISIONS.allow);
    assert.equal(audit.correlationId, "corr-developer-task");
  });

  it("T02 returns organization scope when membership has no assessment", async () => {
    await updateAttributes(prisma, {
      role: SUBJECT_ROLES.developer,
      allowed_actions: [PBAC_ACTIONS.scanRead],
    });

    const response = await getContext(app);
    const body = successBody<DeveloperTaskContextResponse>(response);
    assert.equal(response.status, 200);
    assert.deepEqual(body.scope, {
      type: "organization",
      assessment: null,
    });
  });

  it.each([
    ["with a revocation timestamp", { revokedAt: new Date() }],
    ["expired", { expiresAt: new Date(0) }],
  ])("T03 rejects a %s session with SESSION_INVALID", async (_case, data) => {
    await prisma.authSession.update({ where: { id: SESSION_ID }, data });
    const response = await getContext(app);
    assert.equal(response.status, 401);
    assert.equal(
      problemCode(response),
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.sessionInvalid,
    );
  });

  it("T04 denies immediately after the current policy actions are narrowed", async () => {
    await prisma.authPolicy.update({
      where: { id_version: { id: POLICY_ID, version: POLICY_VERSION } },
      data: { actions: [PBAC_ACTIONS.assessmentRead] },
    });
    const response = await getContext(app);
    assert.equal(response.status, 403);
    assert.equal(
      problemCode(response),
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.pbacDenied,
    );
  });

  it("T05 maps a revoked membership to non-enumerating PBAC_DENIED", async () => {
    await prisma.authMembership.update({
      where: {
        userId_organizationId: { userId: USER_ID, organizationId },
      },
      data: { status: AUTH_MEMBERSHIP_STATUSES.revoked },
    });
    const response = await getContext(app);
    assert.equal(response.status, 403);
    assert.equal(
      problemCode(response),
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.pbacDenied,
    );
    assert.doesNotMatch(JSON.stringify(response.body), /membership/i);
  });

  it.each(["missing", "foreign"])(
    "T06 returns TASK_SCOPE_NOT_FOUND without leaking a %s assessment",
    async (state) => {
      if (state === "missing") {
        await prisma.assessment.delete({ where: { id: ASSESSMENT_ID } });
      } else {
        await prisma.assessment.update({
          where: { id: ASSESSMENT_ID },
          data: {
            organizationId: "foreign-org",
            name: "Secret Foreign Assessment",
          },
        });
      }
      const response = await getContext(app);
      assert.equal(response.status, 404);
      assert.equal(problemCode(response), "TASK_SCOPE_NOT_FOUND");
      assert.doesNotMatch(
        JSON.stringify(response.body),
        /Secret Foreign|foreign-org|developer-task-assessment/i,
      );
    },
  );

  it("rejects malformed persisted assessment scope without attempting a client fallback", async () => {
    await updateAttributes(prisma, {
      role: SUBJECT_ROLES.developer,
      scope: { assessment_id: ASSESSMENT_ID },
      allowed_actions: [PBAC_ACTIONS.scanRead],
    });
    const response = await getContext(app);
    assert.equal(response.status, 403);
    assert.equal(
      problemCode(response),
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.pbacDenied,
    );
  });

  it("T08 denies when the pinned policy cannot be resolved", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = replica",
      );
      await tx.authMembership.update({
        where: {
          userId_organizationId: { userId: USER_ID, organizationId },
        },
        data: { policyVersion: "missing" },
      });
    });
    const response = await getContext(app, "corr-missing-policy");
    assert.equal(response.status, 403);
    assert.equal(
      problemCode(response),
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.pbacDenied,
    );
    const decision = await prisma.authDecisionLog.findFirstOrThrow({
      where: { correlationId: "corr-missing-policy" },
    });
    assert.equal(decision.decision, AUDIT_DECISIONS.deny);
  });

  it("T10 denies a Manager without affecting the regular workspace", async () => {
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: organizationId,
    });
    const managerToken = successBody<{ session_token: string }>(
      signIn,
    ).session_token;
    const denied = await httpRequest(app)
      .get("/workspace/developer-task")
      .set("authorization", `Bearer ${managerToken}`);
    assert.equal(denied.status, 403);
    assert.equal(
      problemCode(denied),
      DEVELOPER_TASK_CONTEXT_ERROR_CODES.pbacDenied,
    );

    const workspace = await httpRequest(app)
      .get("/workspace")
      .set("authorization", `Bearer ${managerToken}`);
    assert.equal(workspace.status, 200);
  });
});

async function seedDeveloper(prisma: PrismaClient, organizationId: string) {
  await prisma.authUser.create({
    data: {
      id: USER_ID,
      email: "developer-task@acme.test",
      passwordHash: hashSecret("DeveloperTaskPassword123!"),
      emailVerified: true,
      failedLoginCount: 0,
    },
  });
  await prisma.authPolicy.create({
    data: {
      id: POLICY_ID,
      version: POLICY_VERSION,
      organizationId,
      subjectRole: SUBJECT_ROLES.developer,
      stateGate: PBAC_STATE_GATES.membershipActive,
      actions: [PBAC_ACTIONS.scanRead, PBAC_ACTIONS.assessmentRead],
    },
  });
  await prisma.authMembership.create({
    data: {
      id: "developer-task-membership",
      userId: USER_ID,
      organizationId,
      status: AUTH_MEMBERSHIP_STATUSES.active,
      subjectAttributes: {
        role: SUBJECT_ROLES.developer,
        scope: ASSESSMENT_ID,
        allowed_actions: [
          PBAC_ACTIONS.scanRead,
          PBAC_ACTIONS.evidenceReadRedacted,
          PBAC_ACTIONS.assessmentRead,
        ],
      },
      policyId: POLICY_ID,
      policyVersion: POLICY_VERSION,
    },
  });
  await prisma.assessment.create({
    data: {
      id: ASSESSMENT_ID,
      organizationId,
      ownerId: USER_ID,
      name: "Developer Assessment",
    },
  });
  await prisma.authSession.create({
    data: {
      id: SESSION_ID,
      userId: USER_ID,
      organizationId,
      tokenHash: hashSecret(TOKEN),
      tokenFingerprint: fingerprintToken(TOKEN),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
}

function updateAttributes(
  prisma: PrismaClient,
  subjectAttributes: Prisma.InputJsonObject,
) {
  return prisma.authMembership.update({
    where: {
      userId_organizationId: { userId: USER_ID, organizationId: "org-1" },
    },
    data: { subjectAttributes },
  });
}

function getContext(app: INestApplication, correlationId = "corr-context") {
  return httpRequest(app)
    .get("/workspace/developer-task")
    .set("authorization", `Bearer ${TOKEN}`)
    .set("x-correlation-id", correlationId);
}
