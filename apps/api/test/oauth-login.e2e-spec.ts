import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
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

import {
  AUTH_RECORD_TYPE,
  authRecordMetadataString,
  createOAuthIdentityRecord,
  createOAuthStateRecord,
  findOAuthStateRecord,
} from "./support/auth-record-test-helpers.js";

const ALLOWED_REDIRECT_URI = "http://localhost:3000/auth/callback";
const GOOGLE_ID_TOKEN_MARKER = "google_id_token_should_never_leak_this_value";

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
  let originalFetch: typeof fetch;
  let oauthNonceForMock: string;

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
    originalFetch = globalThis.fetch;
    oauthNonceForMock = "";
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
      .query({ provider: "google", redirect_uri: ALLOWED_REDIRECT_URI })
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

  it("GitHub OAuth login provider is rejected", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "github", redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.unsupportedProvider);
  });

  it("redirect_uri outside the server allowlist is rejected", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "google", redirect_uri: "http://evil.test/callback" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.invalidRedirectUri);
  });

  it("missing redirect_uri is rejected", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "google" })
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
      .query({ provider: "google", redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(200);

    const success = successBody<OAuthStartSuccess>(result);
    assert.equal("state" in success, false);
    assert.equal("nonce" in success, false);

    const stateRow = await findOAuthStateRecord(prisma);
    assert.ok(stateRow, "expected an OAuth state AuthRecord to be persisted");
    assert.ok(stateRow.expiresAt);
    const ttlMs = stateRow.expiresAt.getTime() - Date.now();
    assert.ok(
      ttlMs > 9 * 60_000 && ttlMs <= 10 * 60_000,
      `unexpected TTL: ${ttlMs}ms`,
    );

    const auditEvents = await prisma.auditEvent.findMany();
    const serialized = JSON.stringify(auditEvents.map((e) => e.payload));
    assert.doesNotMatch(
      serialized,
      new RegExp(authRecordMetadataString(stateRow, "state") ?? ""),
    );
    assert.doesNotMatch(
      serialized,
      new RegExp(authRecordMetadataString(stateRow, "nonce") ?? ""),
    );
    assert.match(serialized, /auth\.oauth\.start\.succeeded/);
  });

  // ── OAuth callback ─────────────────────────────────────────────

  it("rejects a callback missing the code parameter", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ state: "some-state", provider: "google" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("rejects a callback missing the state parameter", async () => {
    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", provider: "google" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("successful OAuth login does not create any RepositoryConnection as side effect", async () => {
    await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "888",
    });
    const before = await prisma.repositoryConnection.count();
    const state = await startOAuthFlow();
    mockGoogleFetch("888");

    await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "google" })
      .expect(200);

    const after = await prisma.repositoryConnection.count();
    assert.equal(after, before);
  });

  it("completes login for a linked, verified account with exactly one active membership", async () => {
    const userId = await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "111",
    });
    const state = await startOAuthFlow();
    mockGoogleFetch("111");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "google" })
      .expect(200);

    const success = successBody<OAuthCallbackSuccess>(result);
    assert.equal(typeof success.session_token, "string");
    assert.equal(success.mfa_required, false);
    assert.ok(success.expires_at > Date.now());

    const session = await prisma.authRecord.findFirst({
      where: { userId, type: AUTH_RECORD_TYPE.session },
    });
    assert.ok(session, "expected a session to be created");
  });

  it("rejects a callback with an unknown state", async () => {
    mockGoogleFetch("222");
    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({
        code: "good-code",
        state: "not-a-real-state",
        provider: "google",
      })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.oauthStateInvalid);
  });

  it("rejects a callback with an expired state", async () => {
    await createOAuthStateRecord(prisma, {
      id: "state-expired",
      state: "expired-state-value",
      nonce: "expired-nonce-value",
      provider: "google",
      redirectUri: ALLOWED_REDIRECT_URI,
      expiresAt: new Date(Date.now() - 1000),
    });
    mockGoogleFetch("333");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({
        code: "good-code",
        state: "expired-state-value",
        provider: "google",
      })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.oauthStateInvalid);
  });

  it("cannot replay a state value across two callback attempts", async () => {
    await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "444",
    });
    const state = await startOAuthFlow();
    mockGoogleFetch("444");

    await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "google" })
      .expect(200);

    const replay = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "google" })
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
      .query({ code: "bad-code", state, provider: "google" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.oauthCallbackInvalid);
    assert.doesNotMatch(JSON.stringify(failure), /bad_verification_code/);

    const auditEvents = await prisma.auditEvent.findMany();
    assert.doesNotMatch(
      JSON.stringify(auditEvents.map((e) => e.payload)),
      new RegExp(GOOGLE_ID_TOKEN_MARKER),
    );
  });

  it("rejects a callback for a provider account with no linked LCSP identity", async () => {
    const state = await startOAuthFlow();
    mockGoogleFetch("999-unknown");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "google" })
      .expect(404);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.accountNotFound);
  });

  it("rejects a callback for a linked account whose email is not yet verified", async () => {
    await seedLinkedUser({
      emailVerified: false,
      providerAccountId: "555",
    });
    const state = await startOAuthFlow();
    mockGoogleFetch("555");

    const result = await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "google" })
      .expect(404);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.accountNotFound);
  });

  it("successful login audit never contains the provider access token", async () => {
    await seedLinkedUser({
      emailVerified: true,
      providerAccountId: "777",
    });
    const state = await startOAuthFlow();
    mockGoogleFetch("777");

    await httpRequest(app)
      .get("/auth/oauth/callback")
      .query({ code: "good-code", state, provider: "google" })
      .expect(200);

    const auditEvents = await prisma.auditEvent.findMany();
    const serialized = JSON.stringify(auditEvents.map((e) => e.payload));
    assert.match(serialized, /auth\.oauth\.login\.succeeded/);
    assert.doesNotMatch(serialized, new RegExp(GOOGLE_ID_TOKEN_MARKER));
  });

  async function startOAuthFlow(): Promise<string> {
    const start = await httpRequest(app)
      .get("/auth/oauth/start")
      .query({ provider: "google", redirect_uri: ALLOWED_REDIRECT_URI })
      .expect(200);
    const success = successBody<OAuthStartSuccess>(start);
    const url = new URL(success.authorization_url);
    const state = url.searchParams.get("state");
    assert.ok(state, "expected a state param on the authorization URL");
    const stateRow = await findOAuthStateRecord(prisma, state);
    assert.ok(stateRow, "expected a state row for the returned state");
    oauthNonceForMock = authRecordMetadataString(stateRow, "nonce") ?? "";
    return state;
  }

  function mockGoogleFetch(providerAccountId: string): void {
    globalThis.fetch = ((input: string | URL | Request) => {
      const urlStr = input instanceof Request ? input.url : input.toString();
      if (urlStr.includes("oauth2.googleapis.com/tokeninfo")) {
        return Promise.resolve(
          fakeResponse(200, {
            sub: providerAccountId,
            email: `oauth-${providerAccountId}@acme.test`,
            email_verified: "true",
            nonce: oauthNonceForMock,
            iss: "https://accounts.google.com",
            aud: process.env.OAUTH_GOOGLE_CLIENT_ID,
            exp: Math.floor(Date.now() / 1000) + 300,
          }),
        );
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return Promise.resolve(
          fakeResponse(200, { id_token: GOOGLE_ID_TOKEN_MARKER }),
        );
      }
      throw new Error(`unexpected fetch call in test: ${urlStr}`);
    }) as unknown as typeof fetch;
  }

  async function seedLinkedUser(input: {
    emailVerified: boolean;
    providerAccountId: string;
  }): Promise<string> {
    const userId = `user-oauth-${input.providerAccountId}`;
    await prisma.user.create({
      data: {
        id: userId,
        email: `oauth-${input.providerAccountId}@acme.test`,
        passwordHash: hashSecret("UnusedPassword123!"),
        emailVerified: input.emailVerified,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
    });
    await createOAuthIdentityRecord(prisma, {
      id: `identity-${input.providerAccountId}`,
      userId,
      provider: "google",
      providerAccountId: input.providerAccountId,
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
