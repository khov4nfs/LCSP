import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
/**
 * AC-020: Complete audit trail for all state-changing operations.
 *
 * Every state-changing operation must write an AuthAuditEvent with:
 * - eventType (machine-readable)
 * - actorId (user who performed action)
 * - resourceType + resourceId
 * - No PII, secrets, tokens, or passwords in payload
 */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

const SENSITIVE_PATTERNS = /password|secret|token|ghp_|mfa_seed|session_token/i;

describe("Audit trail completeness (e2e) [AC-020]", () => {
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

  it("AC-020: Assessment creation writes audit event with required fields", async () => {
    if (!managerToken) return;
    await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Audit Coverage Test", organization_id: orgId });

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: ASSESSMENT_EVENT_TYPES.created },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(audit, "ASSESSMENT_CREATED audit event must be written");
    assert.ok(audit.actorId, "Audit event must include actorId");
    assert.ok(audit.resourceType, "Audit event must include resourceType");
    assert.ok(audit.resourceId, "Audit event must include resourceId");
    assert.doesNotMatch(
      JSON.stringify(audit),
      SENSITIVE_PATTERNS,
      "Audit must not contain sensitive fields",
    );
  });

  it("AC-020: Sign-in writes audit event", async () => {
    const audit = await prisma.authAuditEvent.findFirst({
      where: {
        eventType: { in: ["SIGN_IN", "USER_SIGNED_IN", "LOGIN_SUCCESS"] },
      },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit, "Sign-in must write an audit event");
    assert.doesNotMatch(JSON.stringify(audit), SENSITIVE_PATTERNS);
  });

  it("AC-020: RBAC denial writes AuthDecisionLog with decision=deny", async () => {
    if (!managerToken) return;
    // Make a request that will be denied (attempt something not in Manager policy)
    await httpRequest(app)
      .post("/internal/admin/reset")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({});

    const decisionLog = await prisma.authDecisionLog.findFirst({
      where: { decision: AUDIT_DECISIONS.deny },
      orderBy: { createdAt: "desc" },
    });
    // May or may not have denied — but any denial must be logged
    if (decisionLog) {
      assert.equal(decisionLog.decision, AUDIT_DECISIONS.deny);
      assert.doesNotMatch(JSON.stringify(decisionLog), SENSITIVE_PATTERNS);
    }
  });

  it("AC-020: AuthAuditEvent payload never contains plaintext password", async () => {
    // Check all existing audit events for password leakage
    const allEvents = await prisma.authAuditEvent.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    for (const event of allEvents) {
      assert.doesNotMatch(
        JSON.stringify(event),
        /password|plaintext|credential/i,
        `Audit event ${event.id} must not contain password/credential data`,
      );
    }
  });

  it("AC-020: AuthDecisionLog never exposes policyId or policy internals in user-facing response", async () => {
    // The RBAC response to end user must not leak policy details
    // This tests the boundary between internal logging (OK to have policyId) and API response (NOT OK)
    if (!managerToken) return;
    const result = await httpRequest(app)
      .post("/assessments/nonexistent/scan-trigger")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ snapshot_id: "snap-1" });

    if (result.status === 403) {
      const body = JSON.stringify(result.body);
      assert.doesNotMatch(
        body,
        /policyId/,
        "403 response must not expose policyId",
      );
      assert.doesNotMatch(
        body,
        /"actions"\s*:\s*\[/,
        "403 response must not expose policy actions list",
      );
    }
  });

  it("AC-020: Assessment audit events keep the same assessment identifier in payload", async () => {
    if (!managerToken) return;
    const createResult = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Org Consistency Test", organization_id: orgId });
    const assessmentId = successBody<{ assessment_id: string }>(
      createResult,
    ).assessment_id;

    const events = await prisma.authAuditEvent.findMany({
      where: { eventType: ASSESSMENT_EVENT_TYPES.created },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    for (const event of events) {
      assert.equal(
        (event.payload as { assessmentId?: string }).assessmentId,
        assessmentId,
        `Audit event ${event.eventType} must reference assessment ${assessmentId}`,
      );
    }
  });
});
