import type { AuthMembershipStatus } from "@lcsp/contracts/auth";
import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, successBody } from "./support/http.js";

import { AUTH_ERROR_CODES, type ProblemResult } from "@lcsp/contracts/auth";

import { AppModule } from "../src/app.module.js";
import type {
  OAuthCallbackSuccess,
  OAuthStartSuccess,
} from "../src/modules/auth-workspace/application/contracts/auth-workspace/oauth.contract.js";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  TEST_DATABASE_URL,
  ensureTestMfaEncryptionKey,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
} from "./support/auth-workspace-test-helpers.js";

const ALLOWED_REDIRECT_URI = "http://localhost:3000/auth/callback";
const LEAKED_TOKEN_MARKER = "gho_should_never_leak_this_value";

type FakeFetchResponse = { ok: boolean; json: () => Promise<unknown> };

function fakeResponse(status: number, body: unknown): FakeFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

describe("OAuth login (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let organizationId: string;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ensureTestMfaEncryptionKey();
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
    organizationId = "org-oauth-1";
    await prisma.authOrganization.create({
      data: { id: organizationId, slug: "oauth-acme", name: "OAuth Acme" },
    });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // ── OAuth start ────────────────────────────────────────────────

  it("valid provider and allowlisted redirect_uri returns an authorization URL with a state param", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "github", redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(200);

    const success = successBody<OAuthStartSuccess>(result);
    const url = new URL(success.authorization_url);
    assert.ok(url.searchParams.get("state"));
    assert.equal(typeof success.correlationId, "string");
  });

  it("unsupported provider is rejected", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "gitlab", redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.unsupportedProvider);
  });

  it("redirect_uri outside the server allowlist is rejected", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "github", redirect_uri: "http://evil.test/callback" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.invalidRedirectUri);
  });

  it("missing redirect_uri is rejected", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "github" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("missing provider is rejected", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("persists a state row with a ~10 minute expiry and never returns state/nonce in the response or audit trail", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "github", redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(200);

    const success = successBody<OAuthStartSuccess>(result);
    assert.equal("state" in success, false);
    assert.equal("nonce" in success, false);

    const stateRow = await prisma.authOAuthState.findFirst();
    assert.ok(stateRow, "expected an AuthOAuthState row to be persisted");
    const ttlMs = stateRow.expiresAt.getTime() - Date.now();
    assert.ok(
      ttlMs > 9 * 60_000 && ttlMs <= 10 * 60_000,
      `unexpected TTL: ${ttlMs}ms`,
    );

    const auditEvents = await prisma.authAuditEvent.findMany();
    const serialized = JSON.stringify(auditEvents.map((e) => e.payload));
    assert.doesNotMatch(serialized, new RegExp(stateRow.state));
    assert.doesNotMatch(serialized, new RegExp(stateRow.nonce));
    assert.match(serialized, /auth\.oauth\.start\.succeeded/);
  });

  // ── OAuth callback ─────────────────────────────────────────────

  it("rejects a callback missing the code parameter", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ state: "some-state", provider: "github" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("rejects a callback missing the state parameter", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", provider: "github" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("successful OAuth login does not create any RepositoryConnection as side effect", async () => {
    await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "888",
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
    });
    const before = await prisma.repositoryConnection.count();
    const state = await startOAuthFlow();
    mockGithubFetch("888");

    await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(200);

    const after = await prisma.repositoryConnection.count();
    assert.equal(after, before);
  });

  it("completes login for a linked, verified account with exactly one active membership", async () => {
    const userId = await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "111",
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
    });
    const state = await startOAuthFlow();
    mockGithubFetch("111");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(200);

    const success = successBody<OAuthCallbackSuccess>(result);
    assert.equal(typeof success.session_token, "string");
    assert.equal(success.organization_id, organizationId);
    assert.equal(success.mfa_required, false);
    assert.ok(success.expires_at > Date.now());

    const session = await prisma.authSession.findFirst({
      where: { userId },
    });
    assert.ok(session, "expected a session to be created");
  });

  it("rejects a callback with an unknown state", async () => {
    mockGithubFetch("222");
    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({
        code: "good-code",
        state: "not-a-real-state",
        provider: "github",
      })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.oauthStateInvalid);
  });

  it("rejects a callback with an expired state", async () => {
    await prisma.authOAuthState.create({
      data: {
        id: "state-expired",
        state: "expired-state-value",
        nonce: "expired-nonce-value",
        provider: "github",
        redirectUri: ALLOWED_REDIRECT_URI,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    mockGithubFetch("333");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({
        code: "good-code",
        state: "expired-state-value",
        provider: "github",
      })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.oauthStateInvalid);
  });

  it("cannot replay a state value across two callback attempts", async () => {
    await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "444",
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
    });
    const state = await startOAuthFlow();
    mockGithubFetch("444");

    await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(200);

    const replay = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(400);

    const failure = expectFailure(replay.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.oauthStateInvalid);
  });

  it("maps a token-exchange failure to a safe callback-invalid error without leaking provider detail", async () => {
    const state = await startOAuthFlow();
    globalThis.fetch = (() =>
      Promise.resolve(
        fakeResponse(401, { error: "bad_verification_code" }),
      )) as unknown as typeof fetch;

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "bad-code", state, provider: "github" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.oauthCallbackInvalid);
    assert.doesNotMatch(JSON.stringify(failure), /bad_verification_code/);

    const auditEvents = await prisma.authAuditEvent.findMany();
    assert.doesNotMatch(
      JSON.stringify(auditEvents.map((e) => e.payload)),
      new RegExp(LEAKED_TOKEN_MARKER),
    );
  });

  it("rejects a callback for a provider account with no linked LCSP identity", async () => {
    const state = await startOAuthFlow();
    mockGithubFetch("999-unknown");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(404);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.accountNotFound);
  });

  it("rejects a callback for a linked account whose email is not yet verified", async () => {
    await seedLinkedUser({
      emailVerified: false,
      providerAccountId: "555",
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
    });
    const state = await startOAuthFlow();
    mockGithubFetch("555");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(404);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.accountNotFound);
  });

  it("rejects a callback when the linked account has no active membership", async () => {
    await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "666",
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.revoked,
    });
    const state = await startOAuthFlow();
    mockGithubFetch("666");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(403);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.membershipMissing);
  });

  it("successful login audit never contains the provider access token", async () => {
    await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "777",
      membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
    });
    const state = await startOAuthFlow();
    mockGithubFetch("777");

    await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "github" })
      .expect(200);

    const auditEvents = await prisma.authAuditEvent.findMany();
    const serialized = JSON.stringify(auditEvents.map((e) => e.payload));
    assert.match(serialized, /auth\.oauth\.login\.succeeded/);
    assert.doesNotMatch(serialized, new RegExp(LEAKED_TOKEN_MARKER));
  });

  async function startOAuthFlow(): Promise<string> {
    const start = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "github", redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(200);
    const success = successBody<OAuthStartSuccess>(start);
    const url = new URL(success.authorization_url);
    const state = url.searchParams.get("state");
    assert.ok(state, "expected a state param on the authorization URL");
    return state;
  }

  function mockGithubFetch(providerAccountId: string): void {
    globalThis.fetch = ((input: string | URL) => {
      const urlStr = input.toString();
      if (urlStr.includes("/login/oauth/access_token")) {
        return Promise.resolve(
          fakeResponse(200, { access_token: LEAKED_TOKEN_MARKER }),
        );
      }
      if (urlStr.includes("api.github.com/user")) {
        return Promise.resolve(
          fakeResponse(200, { id: Number(providerAccountId) }),
        );
      }
      throw new Error(`unexpected fetch call in test: ${urlStr}`);
    }) as unknown as typeof fetch;
  }

  async function seedLinkedUser(input: {
    emailVerified: boolean;
    providerAccountId: string;
    membershipStatus: AuthMembershipStatus;
  }): Promise<string> {
    const userId = `user-oauth-${input.providerAccountId}`;
    await prisma.authUser.create({
      data: {
        id: userId,
        email: `oauth-${input.providerAccountId}@acme.test`,
        passwordHash: hashSecret("UnusedPassword123!"),
        emailVerified: input.emailVerified,
        failedLoginCount: 0,
      },
    });
    await prisma.authOAuthIdentity.create({
      data: {
        id: `identity-${input.providerAccountId}`,
        userId,
        provider: "github",
        providerAccountId: input.providerAccountId,
      },
    });
    await prisma.authPolicy.upsert({
      where: {
        id_version: {
          id: "policy-oauth-workspace",
          version: "2026-07-10",
        },
      },
      create: {
        id: "policy-oauth-workspace",
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.workspaceRead],
        subjectRole: SUBJECT_ROLES.manager,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId,
      },
      update: {},
    });
    await prisma.authMembership.create({
      data: {
        id: `membership-${input.providerAccountId}`,
        userId,
        organizationId,
        status: input.membershipStatus,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId: "policy-oauth-workspace",
        policyVersion: "2026-07-10",
      },
    });
    return userId;
  }
});

function expectFailure<T extends object>(
  result: T | ProblemResult,
): ProblemResult {
  if ("problem" in result) {
    return result;
  }

  throw new Error("expected failure");
}
