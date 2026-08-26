import { SIGN_UP_ERROR_CODES } from "@lcsp/contracts/auth";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
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
  ok: true;
  user_id: string;
  display_name: string;
  role: string;
  session_expires_at: string;
  mfa_verified: boolean;
  correlationId: string;
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

  it("creates an account and active session without an invitation", async () => {
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
    assert.ok(body.session_token);
    assert.equal(Number.isNaN(Date.parse(body.expires_at)), false);

    const user = await prisma.authUser.findUniqueOrThrow({
      where: { id: body.user_id },
    });
    assert.equal(user.email, "new.manager@example.test");
    assert.equal(user.displayName, "New Manager");
    assert.equal(user.emailVerified, true);
    assert.equal(user.role, AUTH_USER_ROLES.customer);

    const session = await prisma.authSession.findFirstOrThrow({
      where: {
        userId: body.user_id,
        revokedAt: null,
      },
    });
    assert.equal(Number.isNaN(session.expiresAt.getTime()), false);

    const workspace = await httpRequest(app)
      .get("/workspace")
      .set("Authorization", `Bearer ${body.session_token}`)
      .expect(200);
    const workspaceBody = successBody<WorkspaceBody>(workspace);
    assert.equal(workspaceBody.user_id, body.user_id);
    assert.equal(workspaceBody.display_name, "New Manager");
    assert.equal(workspaceBody.role, AUTH_USER_ROLES.customer);
    assert.equal(
      Number.isNaN(Date.parse(workspaceBody.session_expires_at)),
      false,
    );
    assert.equal(workspaceBody.mfa_verified, false);
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
