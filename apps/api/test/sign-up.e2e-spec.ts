import {
  AUTH_MEMBERSHIP_STATUSES,
  SIGN_UP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignUpResponse } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-up.contract.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
} from "./support/auth-workspace-test-helpers.js";

type WorkspaceBody = {
  organization_id: string;
  organization_name: string;
  user_id: string;
  display_name: string | null;
  membership_status: string;
  subject_role: string;
  granted_actions: string[];
};

describe("Self sign-up endpoint (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates a Manager account, workspace, policy, membership, and active session without an invitation", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-up")
      .set("x-correlation-id", "corr-self-sign-up")
      .send({
        display_name: "New Manager",
        organization_name: "New Legal Team",
        email: "New.Manager@Example.test",
        password: "CorrectHorseBatteryStaple!",
      });

    assert.equal(result.status, 201);
    const body = successBody<SignUpResponse>(result);
    assert.equal(body.correlationId, "corr-self-sign-up");
    assert.ok(body.user_id);
    assert.ok(body.organization_id);
    assert.ok(body.session_token);
    assert.equal(Number.isNaN(Date.parse(body.expires_at)), false);
    assert.ok(body.allowed_actions.includes(PBAC_ACTIONS.workspaceRead));
    assert.ok(body.allowed_actions.includes(PBAC_ACTIONS.inviteDeveloper));

    const user = await prisma.authUser.findUniqueOrThrow({
      where: { id: body.user_id },
    });
    assert.equal(user.email, "new.manager@example.test");
    assert.equal(user.displayName, "New Manager");
    assert.equal(user.emailVerified, true);

    const organization = await prisma.authOrganization.findUniqueOrThrow({
      where: { id: body.organization_id },
    });
    assert.equal(organization.name, "New Legal Team");
    assert.match(organization.slug, /^new-legal-team-[a-z0-9-]+$/);

    const policy = await prisma.authPolicy.findFirstOrThrow({
      where: {
        organizationId: body.organization_id,
        subjectRole: SUBJECT_ROLES.manager,
      },
    });
    assert.equal(policy.stateGate, PBAC_STATE_GATES.membershipActive);
    assert.ok(policy.actions.includes(PBAC_ACTIONS.workspaceRead));

    const membership = await prisma.authMembership.findUniqueOrThrow({
      where: {
        userId_organizationId: {
          userId: body.user_id,
          organizationId: body.organization_id,
        },
      },
    });
    assert.equal(membership.status, AUTH_MEMBERSHIP_STATUSES.active);
    assert.deepEqual(membership.subjectAttributes, {
      role: SUBJECT_ROLES.manager,
    });
    assert.equal(membership.policyId, policy.id);
    assert.equal(membership.policyVersion, policy.version);

    const session = await prisma.authSession.findFirstOrThrow({
      where: {
        userId: body.user_id,
        organizationId: body.organization_id,
        revokedAt: null,
      },
    });
    assert.equal(Number.isNaN(session.expiresAt.getTime()), false);

    const workspace = await httpRequest(app)
      .get("/workspace")
      .set("Authorization", `Bearer ${body.session_token}`)
      .expect(200);
    const workspaceBody = successBody<WorkspaceBody>(workspace);
    assert.equal(workspaceBody.organization_id, body.organization_id);
    assert.equal(workspaceBody.organization_name, "New Legal Team");
    assert.equal(workspaceBody.user_id, body.user_id);
    assert.equal(workspaceBody.display_name, "New Manager");
    assert.equal(
      workspaceBody.membership_status,
      AUTH_MEMBERSHIP_STATUSES.active,
    );
    assert.equal(workspaceBody.subject_role, SUBJECT_ROLES.manager);
    assert.ok(
      workspaceBody.granted_actions.includes(PBAC_ACTIONS.workspaceRead),
    );
  });

  it("rejects duplicate email registration", async () => {
    await httpRequest(app).post("/auth/sign-up").send({
      display_name: "New Manager",
      organization_name: "New Legal Team",
      email: "duplicate@example.test",
      password: "CorrectHorseBatteryStaple!",
    });

    const result = await httpRequest(app).post("/auth/sign-up").send({
      display_name: "Second Manager",
      organization_name: "Second Legal Team",
      email: "DUPLICATE@example.test",
      password: "CorrectHorseBatteryStaple!",
    });

    assert.equal(result.status, 409);
    assert.equal(problemCode(result), SIGN_UP_ERROR_CODES.emailAlreadyExists);
  });

  it("rejects short passwords", async () => {
    const result = await httpRequest(app).post("/auth/sign-up").send({
      display_name: "New Manager",
      organization_name: "New Legal Team",
      email: "short-password@example.test",
      password: "short",
    });

    assert.equal(result.status, 422);
    assert.equal(problemCode(result), SIGN_UP_ERROR_CODES.passwordTooShort);
  });
});
