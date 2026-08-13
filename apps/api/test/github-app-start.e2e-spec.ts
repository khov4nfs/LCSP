import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  AUTH_ERROR_CODES,
  AUTH_MEMBERSHIP_STATUSES,
} from "@lcsp/contracts/auth";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
} from "@lcsp/contracts/github-integration";
import {
  PBAC_ACTIONS,
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
/**
 * MW-gh-001: GitHub App OAuth Start Endpoint.
 * Test cases T01-T08 from docs/implementation/tasks/modules/github-integration/01-github-app-oauth-start-endpoint.md
 */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import type { GitHubAppStartDto } from "../src/modules/github-integration/application/contracts/github-integration/github-app-start.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

const ALLOWED_REDIRECT_URI = "http://localhost:3000/api/github/app/callback";

describe("GitHub App OAuth Start Endpoint (e2e) [MW-gh-001]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;
  const orgId = "org-1";

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
    await prisma.gitHubAppInstallState.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    const signInBody = successBody<SignInSuccess>(signIn);
    managerToken = signInBody?.session_token ?? "";
    await prisma.authSession.updateMany({
      where: { userId: "user-1", organizationId: orgId },
      data: { sensitiveActionVerifiedAt: new Date() },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // T01
  it("T01: Valid actor + allowlisted redirect_uri -> 200 with installation_url", async () => {
    assert.ok(managerToken, "sign-in must succeed for this fixture");

    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<GitHubAppStartDto>(result);

    assert.equal(result.status, 200);
    assert.match(
      body.installation_url,
      /^https:\/\/github\.com\/apps\/.+\/installations\/new\?/,
    );
    assert.match(body.installation_url, /state=/);
    assert.ok(body.correlationId);
  });

  // T02
  it("T02: Actor lacks github:connect -> 403 PBAC_DENIED", async () => {
    const restrictedPolicyId = "policy-no-github-connect";
    await prisma.authPolicy.create({
      data: {
        id: restrictedPolicyId,
        version: "2026-07-17",
        actions: [PBAC_ACTIONS.workspaceRead],
        subjectRole: SUBJECT_ROLES.manager,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const restrictedUserId = "user-no-github-connect";
    await prisma.authUser.create({
      data: {
        id: restrictedUserId,
        email: "restricted-gh@acme.test",
        passwordHash: (
          await import("../src/modules/auth-workspace/infrastructure/security/security.utils.js")
        ).hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-no-github-connect",
        userId: restrictedUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId: restrictedPolicyId,
        policyVersion: "2026-07-17",
      },
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "restricted-gh@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    const restrictedToken =
      successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(restrictedToken, "sign-in must succeed for restricted fixture");

    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${restrictedToken}`);

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), PBAC_REASON_CODE.denied);
  });

  // T03
  it("T03: redirect_uri not in allowlist -> 400 INVALID_REDIRECT_URI", async () => {
    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: "https://evil.example/callback" })
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      GITHUB_INTEGRATION_ERROR_CODES.invalidRedirectUri,
    );
  });

  it("rejects a direct GitHub App start request without recent re-authentication", async () => {
    await prisma.authSession.updateMany({
      where: { userId: "user-1", organizationId: orgId },
      data: { sensitiveActionVerifiedAt: null },
    });

    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), AUTH_ERROR_CODES.reauthRequired);
  });

  // T04
  it("T04: assessment_id not in org -> 400 ASSESSMENT_NOT_FOUND", async () => {
    await prisma.assessment.create({
      data: {
        id: "assessment-other-org",
        organizationId: "org-other",
        ownerId: "someone-else",
        name: "Other Org Assessment",
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
    });

    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({
        redirect_uri: ALLOWED_REDIRECT_URI,
        assessment_id: "assessment-other-org",
      })
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 400);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.notFound);
  });

  // T05
  it("T05: GitHubAppInstallState created with ~10-minute expiry", async () => {
    const before = Date.now();

    await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${managerToken}`);

    const row = await prisma.gitHubAppInstallState.findFirst({
      where: { organizationId: orgId, userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(row, "GitHubAppInstallState row must exist");
    const ttlMs = new Date(row.expiresAt).getTime() - before;
    assert.ok(ttlMs > 9 * 60_000 && ttlMs <= 10 * 60_000 + 5000);
  });

  // T06
  it("T06: response has no state field", async () => {
    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${managerToken}`);
    const body = result.body as Record<string, unknown>;

    assert.equal(result.status, 200);
    assert.equal(body.state, undefined);
  });

  // T07
  it("T07: no LCSP session created as a side effect", async () => {
    const before = await prisma.authSession.count();

    await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${managerToken}`);

    const after = await prisma.authSession.count();
    assert.equal(after, before);
  });

  // T08
  it("T08: GITHUB_APP_INSTALL_STARTED audit event has no state value in payload", async () => {
    await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${managerToken}`);

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: GITHUB_INTEGRATION_EVENT_TYPES.appInstallStarted },
      orderBy: { createdAt: "desc" },
    });
    const installState = await prisma.gitHubAppInstallState.findFirst({
      where: { organizationId: orgId, userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(audit, "GITHUB_APP_INSTALL_STARTED audit event must be written");
    assert.ok(installState, "install state row must exist");
    assert.doesNotMatch(
      JSON.stringify(audit.payload),
      new RegExp(installState.state),
    );
  });

  it("starts a managed installation update for an existing repository connection", async () => {
    await prisma.repositoryConnection.create({
      data: {
        id: "repo-connection-manage",
        assessmentId: null,
        organizationId: orgId,
        userId: "user-1",
        installationId: "installation-manage",
        repositoryId: "repo-1",
        repositoryName: "lcsp",
        repositoryFullName: "khovan123/LCSP",
        defaultBranch: "main",
        permissions: { contents: "READ" },
      },
    });

    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({
        redirect_uri: ALLOWED_REDIRECT_URI,
        installation_id: "installation-manage",
      })
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<GitHubAppStartDto>(result);

    assert.equal(result.status, 200);
    assert.match(body.installation_url, /state=/);
    assert.match(body.installation_url, /redirect_uri=/);
  });

  it("rejects a managed installation update outside the current workspace", async () => {
    const result = await httpRequest(app)
      .get("/github/app/start")
      .query({
        redirect_uri: ALLOWED_REDIRECT_URI,
        installation_id: "installation-other",
      })
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
    );
  });
});
