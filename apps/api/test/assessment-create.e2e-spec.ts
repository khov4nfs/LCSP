import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  OUTBOX_MESSAGE_SCHEMA_VERSION,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
/**
 * MW-asmt-001: Create Assessment Endpoint.
 * Test cases T01-T08 from docs/implementation/tasks/modules/assessment/01-create-assessment-endpoint.md
 */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { CreateAssessmentDto } from "../src/modules/assessment/application/contracts/assessment/create-assessment.contract.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

describe("Create Assessment Endpoint (e2e) [MW-asmt-001]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let customerToken: string;

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
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    const signInBody = successBody<SignInSuccess>(signIn);
    customerToken = signInBody?.session_token ?? "";
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // T01
  it("T01: CUSTOMER with required role + valid name -> 201, assessment created", async () => {
    assert.ok(customerToken, "sign-in must succeed for this fixture");

    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name: "My AI System Assessment" });
    const body = successBody<CreateAssessmentDto>(result);

    assert.equal(result.status, 201);
    assert.ok(body.assessment_id);
    assert.equal(body.name, "My AI System Assessment");
    assert.equal(body.status, ASSESSMENT_STATUS_CODES.wizardInProgress);
    assert.equal(body.owner_id, "user-1");
    assert.ok(body.created_at);
    assert.ok(body.correlationId);
  });

  // T02
  it("T02: ADMIN without CUSTOMER role -> 403 RBAC_DENIED", async () => {
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "nomembership@acme.test",
      password: "NoMembership123!",
    });
    const adminToken = successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(adminToken, "sign-in must succeed for admin fixture");

    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Should Be Denied" });

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), AUTH_ERROR_CODES.rbacDenied);
  });

  // T03
  it("T03: Missing name -> 422 INVALID_REQUEST", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({});

    assert.equal(result.status, 422);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.invalidRequest);
  });

  // T04, T05, T06
  it("T04/T05/T06: DB row has WIZARD_IN_PROGRESS status and correct ownerId", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name: "DB Verification Test" });
    const body = successBody<CreateAssessmentDto>(result);

    const row = await prisma.assessment.findUnique({
      where: { id: body.assessment_id },
    });

    assert.ok(row, "assessment row must exist");
    assert.equal(row?.status, ASSESSMENT_STATUS_CODES.wizardInProgress);
    assert.equal(row?.ownerId, "user-1");
  });

  // T07
  it("T07: ASSESSMENT_CREATED audit event has no name content in payload", async () => {
    await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        name: "Confidential Project Codename",
        description: "Sensitive detail",
      });

    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: ASSESSMENT_EVENT_TYPES.created },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(audit, "ASSESSMENT_CREATED audit event must be written");
    assert.equal(
      (audit.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
    assert.doesNotMatch(
      JSON.stringify(audit.payload),
      /Confidential Project Codename/,
    );
    assert.doesNotMatch(JSON.stringify(audit.payload), /Sensitive detail/);
  });

  it("Assessment creation enqueues an assessment.created OutboxMessage", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name: "Outbox Test" });
    const body = successBody<CreateAssessmentDto>(result);

    const outbox = await prisma.outboxMessage.findFirst({
      where: {
        aggregateId: body.assessment_id,
        eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
      },
    });

    assert.ok(outbox, "assessment.created OutboxMessage must be written");
    assert.equal(outbox?.status, OUTBOX_STATUSES.pending);
    const payload = outbox?.payload as {
      schemaVersion?: string;
      correlationId?: string;
      causationId?: string;
      idempotencyKey?: string;
    };
    assert.equal(payload.schemaVersion, OUTBOX_MESSAGE_SCHEMA_VERSION);
    assert.equal(payload.correlationId, body.correlationId);
    assert.equal(payload.causationId, body.correlationId);
    assert.equal(
      payload.idempotencyKey,
      `${body.assessment_id}:${ASSESSMENT_EVENT_TYPES.createdOutbox}`,
    );
  });
});
