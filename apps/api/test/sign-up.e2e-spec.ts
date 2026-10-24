import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  SIGN_UP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import { GITHUB_INTEGRATION_EVENT_TYPES } from "@lcsp/contracts/github-integration";
import { jest } from "@jest/globals";
import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import { PrismaUserRepository } from "../src/modules/auth/infrastructure/persistence/prisma-auth.repositories.js";
import {
  AUTH_RECORD_TYPES,
  authRecordMetadataString,
} from "../src/modules/auth/infrastructure/persistence/auth-record.persistence.js";
import {
  GITHUB_REPOSITORY_PROVIDER,
  type GitHubRepositoryProviderPort,
} from "../src/modules/github-integration/application/ports/github-repository-provider.port.js";
import { hashSecret } from "../src/modules/auth/infrastructure/security/security.utils.js";
import type { AuthProfileSuccess } from "../src/modules/auth/application/contracts/auth/settings.contract.js";
import type { SignUpResponse } from "../src/modules/auth/application/contracts/auth/sign-up.contract.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
} from "./support/auth-workspace-test-helpers.js";

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

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: body.user_id },
    });
    assert.equal(user.email, "new.manager@example.test");
    assert.equal(user.displayName, "New Manager");
    assert.equal(user.emailVerified, true);
    assert.equal(user.role, AUTH_USER_ROLES.customer);
    assert.match(user.mfaGenerationId, /^[0-9a-f-]{36}$/i);

    const session = await prisma.authRecord.findFirstOrThrow({
      where: {
        userId: body.user_id,
        type: AUTH_RECORD_TYPES.session,
        revokedAt: null,
      },
    });
    assert.equal(
      authRecordMetadataString(session, "mfaGenerationId"),
      user.mfaGenerationId,
      "first sign-up session must share the account's persisted MFA generation",
    );
    assert.ok(session.expiresAt);
    assert.equal(Number.isNaN(session.expiresAt.getTime()), false);

    const profile = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${body.session_token}`)
      .expect(200);
    const profileBody = successBody<AuthProfileSuccess>(profile);
    assert.equal(profileBody.user_id, body.user_id);
    assert.equal(profileBody.display_name, "New Manager");
    assert.equal(profileBody.role, AUTH_USER_ROLES.customer);
    assert.equal(
      Number.isNaN(Date.parse(profileBody.current_session_expires_at)),
      false,
    );
    assert.equal(profileBody.mfa_verified, false);
  });

  it("allows the initial sign-up session to reauthenticate and access a guarded sensitive route", async () => {
    const password = "InitialSignUpPassword123!";
    const registration = await httpRequest(app)
      .post("/auth/sign-up")
      .send({
        display_name: "New Account",
        organization_name: "Example Workspace",
        email: "step-up-new-signup@example.test",
        password,
      })
      .expect(201);
    const registered = successBody<SignUpResponse>(registration);

    const profile = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${registered.session_token}`)
      .expect(200);
    assert.equal(
      successBody<AuthProfileSuccess>(profile).user_id,
      registered.user_id,
    );

    const sensitiveRoute = "/github/repository-discoveries";
    const credential = "local-test-provider-credential-1234567890";
    const notElevated = await httpRequest(app)
      .post(sensitiveRoute)
      .set("Authorization", `Bearer ${registered.session_token}`)
      .send({ credential, limit: 1 })
      .expect(403);
    assert.equal(problemCode(notElevated), AUTH_ERROR_CODES.reauthRequired);

    const reauthentication = await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${registered.session_token}`)
      .send({
        session_token: registered.session_token,
        password,
      })
      .expect(201);
    assert.equal(
      successBody<{ verified: boolean }>(reauthentication).verified,
      true,
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: registered.user_id },
    });
    const session = await prisma.authRecord.findFirstOrThrow({
      where: {
        userId: user.id,
        type: AUTH_RECORD_TYPES.session,
        revokedAt: null,
      },
    });
    assert.equal(
      authRecordMetadataString(session, "mfaGenerationId"),
      user.mfaGenerationId,
    );
    assert.ok(
      authRecordMetadataString(session, "sensitiveActionVerifiedAt"),
      "password step-up must be persisted against the initial generation",
    );

    const check = await httpRequest(app)
      .post("/auth/sensitive-route/check")
      .set("Authorization", `Bearer ${registered.session_token}`)
      .send({ method: "POST", path: sensitiveRoute })
      .expect(200);
    const sensitiveDecision = successBody<{
      is_sensitive: boolean;
      reauth_required: boolean;
    }>(check);
    assert.equal(sensitiveDecision.is_sensitive, true);
    assert.equal(sensitiveDecision.reauth_required, false);

    // Preserve real RBAC, step-up, HTTP routing and audit behavior while
    // replacing only the external GitHub provider with deterministic outputs.
    const provider = app.get<GitHubRepositoryProviderPort>(
      GITHUB_REPOSITORY_PROVIDER,
    );
    const validateIdentity = jest
      .spyOn(provider, "validateIdentity")
      .mockResolvedValue({
        id: "provider-user-1",
        login: "test-provider-user",
        htmlUrl: "https://github.com/test-provider-user",
      });
    const listRepositories = jest
      .spyOn(provider, "listAccessibleRepositories")
      .mockResolvedValue([]);
    try {
      const discovery = await httpRequest(app)
        .post(sensitiveRoute)
        .set("Authorization", `Bearer ${registered.session_token}`)
        .send({ credential, limit: 1 })
        .expect(200);
      const result = successBody<{
        authenticated_account: { id: string; login: string };
        repositories: unknown[];
      }>(discovery);
      assert.deepEqual(result.authenticated_account, {
        id: "provider-user-1",
        login: "test-provider-user",
      });
      assert.deepEqual(result.repositories, []);
      assert.equal(validateIdentity.mock.calls.length, 1);
      assert.equal(listRepositories.mock.calls.length, 1);
      assert.equal(
        await prisma.auditEvent.count({
          where: {
            actorId: registered.user_id,
            eventType:
              GITHUB_INTEGRATION_EVENT_TYPES.cliRepositoryDiscoverySucceeded,
          },
        }),
        1,
        "authorized sensitive action must remain audited",
      );
    } finally {
      validateIdentity.mockRestore();
      listRepositories.mockRestore();
    }
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

  it("serializes concurrent registrations without duplicate users or sessions", async () => {
    const payload = {
      display_name: "Concurrent Customer",
      organization_name: "Example Workspace",
      email: "racing@example.test",
      password: "CorrectHorseBatteryStaple!",
    };
    const results = await Promise.all([
      httpRequest(app).post("/auth/sign-up").send(payload),
      httpRequest(app).post("/auth/sign-up").send(payload),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(
      await prisma.user.count({ where: { email: payload.email } }),
      1,
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    assert.equal(
      await prisma.authRecord.count({ where: { userId: user.id } }),
      1,
    );
  });

  it("never overwrites changed credentials through profile, MFA, or stale login writes", async () => {
    const registered = await httpRequest(app).post("/auth/sign-up").send({
      display_name: "Race Test",
      organization_name: "Example Workspace",
      email: "credential-race@example.test",
      password: "CorrectHorseBatteryStaple!",
    });
    assert.equal(registered.status, 201);
    const userId = successBody<SignUpResponse>(registered).user_id;
    const users = app.get(PrismaUserRepository);
    const staleUser = await users.findById(userId);
    assert.ok(staleUser);
    const newHash = hashSecret("AnotherNewPassword456!");
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, accessVersion: { increment: 1 } },
    });

    assert.equal(
      await users.recordFailedLoginAttempt(
        userId,
        staleUser.passwordHash,
        Date.now(),
        3,
        300000,
      ),
      null,
    );
    assert.equal(
      await users.clearFailedLoginsIfCredentialsCurrent(
        userId,
        staleUser.passwordHash,
        Date.now(),
      ),
      null,
    );
    await users.updateProfile(userId, {
      displayName: "Updated without touching password",
    });
    // MFA cannot be enabled unless an enrollment has been verified.
    assert.equal(await users.setMfaRequired(userId, true), false);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    assert.equal(stored.passwordHash, newHash);
    assert.equal(stored.displayName, "Updated without touching password");
    assert.equal(stored.mfaRequired, false);
    assert.equal(stored.accessVersion, 1);
  });

  it("rejects short passwords", async () => {
    const result = await httpRequest(app).post("/auth/sign-up").send({
      display_name: "New Manager",
      organization_name: "New Legal Team",
      email: "short-password@example.test",
      password: "short",
    });

    assert.equal(result.status, 400);
    assert.equal(problemCode(result), AUTH_ERROR_CODES.validationFailed);
  });
});
