import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
/**
 * MW-gh-002: GitHub App Callback Endpoint.
 * Test cases T01-T09 from docs/implementation/tasks/modules/github-integration/02-github-app-callback-endpoint.md
 */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import type { GitHubAppCallbackDto } from "../src/modules/github-integration/application/contracts/github-integration/github-app-callback.contract.js";
import type { GitHubAppStartDto } from "../src/modules/github-integration/application/contracts/github-integration/github-app-start.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

type FakeFetchResponse = { ok: boolean; json: () => Promise<unknown> };

const ALLOWED_REDIRECT_URI = "http://localhost:3000/api/github/app/callback";
const LEAKED_TOKEN_MARKER = "ghs_should_never_leak_this_value";
const INSTALLATION_ID = "installation-42";

function fakeResponse(status: number, body: unknown): FakeFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

describe("GitHub App Callback Endpoint (e2e) [MW-gh-002]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;
  let originalFetch: typeof fetch;
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
    await prisma.repositoryConnection.deleteMany();
    await prisma.gitHubAppInstallState.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    originalFetch = globalThis.fetch;

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

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await prisma.repositoryConnection.deleteMany();
    await prisma.gitHubAppInstallState.deleteMany();
    await app.close();
    await prisma.$disconnect();
  });

  async function startInstallFlow(): Promise<string> {
    assert.ok(managerToken, "sign-in must succeed for this fixture");

    const start = await httpRequest(app)
      .get("/github/app/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<GitHubAppStartDto>(start);
    const url = new URL(body.installation_url);
    const state = url.searchParams.get("state");
    assert.ok(state, "expected a state param on the installation url");
    return state;
  }

  function mockGithubAppFetch(
    permissions: Record<string, string> = {
      contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read,
    },
    repositories: Array<{
      id: number;
      name: string;
      full_name: string;
      default_branch: string;
    }> = [
      {
        id: 555,
        name: "example-repo",
        full_name: "acme/example-repo",
        default_branch: "main",
      },
    ],
  ): void {
    globalThis.fetch = ((input: string | URL) => {
      const urlStr = input.toString();
      if (urlStr.includes("/login/oauth/access_token")) {
        return Promise.resolve(
          fakeResponse(200, { access_token: LEAKED_TOKEN_MARKER }),
        );
      }
      if (urlStr.endsWith("/user/installations?per_page=100")) {
        return Promise.resolve(
          fakeResponse(200, {
            installations: [{ id: INSTALLATION_ID, permissions }],
          }),
        );
      }
      if (
        urlStr.endsWith(`/user/installations/${INSTALLATION_ID}/repositories`)
      ) {
        return Promise.resolve(
          fakeResponse(200, {
            repositories,
          }),
        );
      }
      throw new Error(`unexpected fetch call in test: ${urlStr}`);
    }) as unknown as typeof fetch;
  }

  function mockGithubTokenExchangeFailure(): void {
    globalThis.fetch = (() =>
      Promise.resolve(
        fakeResponse(401, { error: "bad_verification_code" }),
      )) as unknown as typeof fetch;
  }

  // T01
  it("T01: valid state + valid installation -> 200 connection created", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch();

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });
    const body = successBody<GitHubAppCallbackDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.repository_full_name, "acme/example-repo");
    assert.equal(body.default_branch, "main");
    assert.equal(body.status, REPOSITORY_CONNECTION_STATUSES.active);
    assert.ok(body.connection_id);
    assert.ok(body.correlationId);

    const connection = await prisma.repositoryConnection.findUnique({
      where: { id: body.connection_id },
    });
    assert.ok(connection, "RepositoryConnection row must exist");
  });

  it("connects every repository when GitHub callback omits repository_id for a multi-repository installation", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch({ contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read }, [
      {
        id: 555,
        name: "example-repo",
        full_name: "acme/example-repo",
        default_branch: "main",
      },
      {
        id: 777,
        name: "second-repo",
        full_name: "acme/second-repo",
        default_branch: "trunk",
      },
    ]);

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });
    const body = successBody<GitHubAppCallbackDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.repository_full_name, "acme/example-repo");

    const connections = await prisma.repositoryConnection.findMany({
      orderBy: { repositoryFullName: "asc" },
    });
    assert.deepEqual(
      connections.map((connection) => connection.repositoryFullName),
      ["acme/example-repo", "acme/second-repo"],
    );
  });

  it("updates an existing repository connection when GitHub App is re-authorized", async () => {
    await prisma.repositoryConnection.create({
      data: {
        id: "existing-connection-1",
        assessmentId: null,
        organizationId: orgId,
        userId: "user-1",
        installationId: INSTALLATION_ID,
        repositoryId: "555",
        repositoryName: "old-name",
        repositoryFullName: "acme/old-name",
        defaultBranch: "master",
        permissions: { contents: "read" },
        status: "ACTIVE",
      },
    });
    const state = await startInstallFlow();
    mockGithubAppFetch();

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    assert.equal(result.status, 200);
    const connections = await prisma.repositoryConnection.findMany({
      where: { installationId: INSTALLATION_ID, repositoryId: "555" },
    });
    assert.equal(connections.length, 1);
    assert.equal(connections[0]?.id, "existing-connection-1");
    assert.equal(connections[0]?.repositoryFullName, "acme/example-repo");
    assert.equal(connections[0]?.defaultBranch, "main");
  });

  // T02
  it("T02: state not found -> 400 GITHUB_STATE_INVALID", async () => {
    mockGithubAppFetch();

    const result = await httpRequest(app).get("/github/app/callback").query({
      installation_id: INSTALLATION_ID,
      code: "good-code",
      state: "unknown-state",
    });

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
    );
  });

  // T03
  it("T03: expired state -> 400 GITHUB_STATE_INVALID", async () => {
    const state = await startInstallFlow();
    await prisma.gitHubAppInstallState.updateMany({
      where: { state },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    mockGithubAppFetch();

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
    );
  });

  // T04
  it("T04: token exchange fails -> 400 GITHUB_CALLBACK_INVALID", async () => {
    const state = await startInstallFlow();
    mockGithubTokenExchangeFailure();

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "bad-code", state });

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      GITHUB_INTEGRATION_ERROR_CODES.githubCallbackInvalid,
    );
  });

  // T05
  it("T05: installation has write permissions -> 400 PERMISSIONS_INSUFFICIENT", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch({ contents: "write" });

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
    );
  });

  it("rejects installations that include extra non-required permissions", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch({
      contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read,
      pull_requests: "WRITE",
    });

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    assert.equal(result.status, 400);
    assert.equal(
      problemCode(result),
      GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
    );
  });

  it("uses selected repository_id when multiple authorized repositories exist", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch({ contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read }, [
      {
        id: 555,
        name: "example-repo",
        full_name: "acme/example-repo",
        default_branch: "main",
      },
      {
        id: 777,
        name: "selected-repo",
        full_name: "acme/selected-repo",
        default_branch: "trunk",
      },
    ]);

    const result = await httpRequest(app).get("/github/app/callback").query({
      installation_id: INSTALLATION_ID,
      code: "good-code",
      state,
      repository_id: "777",
    });
    const body = successBody<GitHubAppCallbackDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.repository_full_name, "acme/selected-repo");
    assert.equal(body.default_branch, "trunk");
  });

  // T06
  it("T06: raw token is not stored in DB or returned in response", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch();

    const result = await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    assert.doesNotMatch(
      JSON.stringify(result.body),
      new RegExp(LEAKED_TOKEN_MARKER),
    );

    const connections = await prisma.repositoryConnection.findMany();
    assert.doesNotMatch(
      JSON.stringify(connections),
      new RegExp(LEAKED_TOKEN_MARKER),
    );
  });

  // T07
  it("T07: no LCSP session created as a side effect", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch();
    const before = await prisma.authSession.count();

    await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    const after = await prisma.authSession.count();
    assert.equal(after, before);
  });

  // T08
  it("T08: GitHubAppInstallState is deleted after use", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch();

    await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    const row = await prisma.gitHubAppInstallState.findUnique({
      where: { state },
    });
    assert.equal(row, null);
  });

  // T09
  it("T09: GITHUB_APP_CONNECTED audit event has no token in payload", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch();

    await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: GITHUB_INTEGRATION_EVENT_TYPES.appConnected },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(audit, "GITHUB_APP_CONNECTED audit event must be written");
    assert.doesNotMatch(
      JSON.stringify(audit.payload),
      new RegExp(LEAKED_TOKEN_MARKER),
    );
  });

  it("audits callback denial without leaking token", async () => {
    const state = await startInstallFlow();
    mockGithubAppFetch({ contents: "WRITE" });

    await httpRequest(app)
      .get("/github/app/callback")
      .query({ installation_id: INSTALLATION_ID, code: "good-code", state });

    const audit = await prisma.authAuditEvent.findFirst({
      where: {
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.appConnectionRejected,
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(
      audit,
      "GITHUB_APP_CONNECTION_REJECTED audit event must be written",
    );
    assert.equal(
      audit.reasonCode,
      GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
    );
    assert.doesNotMatch(
      JSON.stringify(audit.payload),
      new RegExp(LEAKED_TOKEN_MARKER),
    );
  });
});
