import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import {
  OUTBOX_MESSAGE_SCHEMA_VERSION,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import {
  PBAC_ACTIONS,
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // T01
  it("T01: Manager with assessment:create + valid name -> 201, assessment created", async () => {
    assert.ok(managerToken, "sign-in must succeed for this fixture");

    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "My AI System Assessment" });
    const body = successBody<CreateAssessmentDto>(result);

    assert.equal(result.status, 201);
    assert.ok(body.assessment_id);
    assert.equal(body.name, "My AI System Assessment");
    assert.equal(body.status, ASSESSMENT_STATUS_CODES.wizardInProgress);
    assert.equal(body.owner_id, "user-1");
    assert.equal(body.organization_id, orgId);
    assert.ok(body.created_at);
    assert.ok(body.correlationId);
  });

  // T02
  it("T02: Manager lacking assessment:create -> 403 PBAC_DENIED", async () => {
    const restrictedPolicyId = "policy-no-assessment-create";
    await prisma.authPolicy.create({
      data: {
        id: restrictedPolicyId,
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.workspaceRead],
        subjectRole: SUBJECT_ROLES.manager,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const restrictedUserId = "user-no-assessment-create";
    await prisma.authUser.create({
      data: {
        id: restrictedUserId,
        email: "restricted@acme.test",
        passwordHash: (
          await import("../src/modules/auth-workspace/infrastructure/security/security.utils.js")
        ).hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-no-assessment-create",
        userId: restrictedUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId: restrictedPolicyId,
        policyVersion: "2026-07-10",
      },
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "restricted@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    const restrictedToken =
      successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(restrictedToken, "sign-in must succeed for restricted fixture");

    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${restrictedToken}`)
      .send({ name: "Should Be Denied" });

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), PBAC_REASON_CODE.denied);
  });

  // T03
  it("T03: Missing name -> 422 INVALID_REQUEST", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({});

    assert.equal(result.status, 422);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.invalidRequest);
  });

  // T04, T05, T06
  it("T04/T05/T06: DB row has WIZARD_IN_PROGRESS status, correct ownerId and organizationId", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "DB Verification Test" });
    const body = successBody<CreateAssessmentDto>(result);

    const row = await prisma.assessment.findUnique({
      where: { id: body.assessment_id },
    });

    assert.ok(row, "assessment row must exist");
    assert.equal(row?.status, ASSESSMENT_STATUS_CODES.wizardInProgress);
    assert.equal(row?.ownerId, "user-1");
    assert.equal(row?.organizationId, orgId);
  });

  // T07
  it("T07: ASSESSMENT_CREATED audit event has no name content in payload", async () => {
    await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        name: "Confidential Project Codename",
        description: "Sensitive detail",
      });

    const audit = await prisma.authAuditEvent.findFirst({
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

  // T08
  it("T08: response contains no Developer assignment fields", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "No Developer Test" });
    // Intentionally untyped here (not CreateAssessmentDto) — the DTO's whole
    // point is that it never declares these fields, so checking their absence
    // needs an escape hatch rather than the strict contract type.
    const body = result.body as Record<string, unknown>;

    assert.equal(result.status, 201);
    assert.equal(body.developer_id, undefined);
    assert.equal(body.developerId, undefined);
  });

  it("Assessment creation enqueues an assessment.created OutboxMessage", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
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
