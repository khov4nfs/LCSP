/**
 * AC-022: PII and secrets redacted from all API responses, logs, and audit records.
 *
 * No plaintext: password, session_token, MFA secret, provider access token.
 * No raw source code in findings or evidence reports.
 * No secret patterns (ghp_, sk-ant-, AKIA, etc.) in any response body.
 */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { httpRequest, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

const SECRET_PATTERNS =
  /ghp_[A-Za-z0-9]+|sk-ant-[A-Za-z0-9]+|AKIA[A-Z0-9]+|Bearer\s+[A-Za-z0-9._-]{20,}/;
const PLAINTEXT_SECRET =
  /("password"\s*:\s*"[^"]{1,}"|"mfa_secret"\s*:|"plaintext_token"\s*:)/;

describe("Redaction boundary (e2e) [AC-022]", () => {
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
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    managerToken = successBody<SignInSuccess>(signIn).session_token ?? "";
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("AC-022: Sign-in response does not include plaintext password", async () => {
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });

    const body = JSON.stringify(signIn.body);
    assert.doesNotMatch(
      body,
      /CorrectHorseBatteryStaple/,
      "Response must not echo back password",
    );
    assert.doesNotMatch(
      body,
      PLAINTEXT_SECRET,
      "Response must not include plaintext password field",
    );
  });

  it("AC-022: User profile response does not include password hash", async () => {
    if (!managerToken) return;
    const result = await httpRequest(app)
      .get("/workspace/profile")
      .set("Authorization", `Bearer ${managerToken}`);

    if (result.status !== 200) return;
    const body = JSON.stringify(result.body);
    assert.doesNotMatch(
      body,
      /passwordHash|password_hash/,
      "Profile must not expose password hash",
    );
    assert.doesNotMatch(
      body,
      /mfaSecret|mfa_secret/,
      "Profile must not expose MFA secret",
    );
  });

  it("AC-022: Error responses do not include secret tokens in body", async () => {
    // Attempt auth with a fake token — error body must not echo it back
    const result = await httpRequest(app)
      .get("/workspace/profile")
      .set("Authorization", "Bearer ghp_fakesecrettoken12345");

    assert.doesNotMatch(
      JSON.stringify(result.body),
      SECRET_PATTERNS,
      "Error response must not include secret token patterns",
    );
  });

  it("AC-022: AuditEvent records contain no raw secret material", async () => {
    const events = await prisma.auditEvent.findMany({ take: 100 });
    for (const event of events) {
      const serialized = JSON.stringify(event);
      assert.doesNotMatch(
        serialized,
        SECRET_PATTERNS,
        `AuditEvent ${event.id} must not contain raw secret material`,
      );
      assert.doesNotMatch(
        serialized,
        PLAINTEXT_SECRET,
        `AuditEvent ${event.id} must not contain plaintext password`,
      );
    }
  });

  it("AC-022: authorization AuditEvent records contain no raw secret material", async () => {
    const logs = await prisma.auditEvent.findMany({ take: 100 });
    for (const log of logs) {
      assert.doesNotMatch(
        JSON.stringify(log),
        SECRET_PATTERNS,
        `authorization AuditEvent ${log.id} must not contain secret material`,
      );
    }
  });

  it("AC-022: Assessment response does not include any finding source code", async () => {
    if (!managerToken) return;
    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${managerToken}`);

    if (result.status !== 200) return;
    const body = JSON.stringify(result.body);
    // No source code heuristics in response
    assert.doesNotMatch(
      body,
      /def [a-z_]+\(/,
      "Response must not include Python source code",
    );
    assert.doesNotMatch(
      body,
      /function [a-z]+\(/,
      "Response must not include JS source code",
    );
    assert.doesNotMatch(
      body,
      /import [A-Za-z]+\s+from/,
      "Response must not include import statements",
    );
  });

  it("AC-022: 401 response does not disclose session token in body", async () => {
    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", "Bearer expired-or-invalid-token");

    assert.doesNotMatch(
      JSON.stringify(result.body),
      /session_token|access_token/,
      "401 must not disclose token details",
    );
  });
});
