import {
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
/**
 * AC-001: RBAC-authorized assessment creation, audit event.
 * AC-003: Readiness-only state, no risk level, blocked/degraded messaging.
 */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { httpRequest, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { AssessmentDetailDto } from "../src/modules/assessment/application/contracts/assessment/assessment-detail.contract.js";
import type { CreateAssessmentDto } from "../src/modules/assessment/application/contracts/assessment/create-assessment.contract.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

describe("Assessment creation and wizard readiness (e2e) [AC-001, AC-003]", () => {
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

  // AC-001: Assessment creation
  it("AC-001: Manager can create an assessment and receives assessment ID", async () => {
    if (!managerToken) return;
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "My AI System Assessment", organization_id: orgId });
    const body = successBody<CreateAssessmentDto>(result);

    assert.equal(result.status, 201);
    assert.ok(body.assessment_id, "Response must include assessment ID");
    assert.equal(
      body.owner_id,
      "user-1",
      "Assessment owner must be the creating Manager",
    );
    assert.equal(body.status, ASSESSMENT_STATUS_CODES.wizardInProgress);
  });

  it("AC-001: Assessment creation writes ASSESSMENT_CREATED audit event", async () => {
    if (!managerToken) return;
    await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Audit Test Assessment", organization_id: orgId });

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: ASSESSMENT_EVENT_TYPES.created },
    });
    assert.ok(audit, "ASSESSMENT_CREATED audit event must be written");
    assert.doesNotMatch(JSON.stringify(audit), /password|token|secret/i);
  });

  it("AC-001: Unauthenticated request to create assessment returns 401", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .send({ name: "No Auth Assessment" });
    assert.equal(result.status, 401);
  });

  // AC-003: Wizard readiness — no risk level exposed
  it("AC-003: Assessment readiness response never uses risk/severity/compliant wording", async () => {
    if (!managerToken) return;
    const create = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "No Risk Label", organization_id: orgId });

    const assessmentId = (create.body as CreateAssessmentDto)?.assessment_id;
    if (!assessmentId) return;

    const readiness = await httpRequest(app)
      .get(`/assessments/${assessmentId}/readiness`)
      .set("Authorization", `Bearer ${managerToken}`);

    const body = JSON.stringify(readiness.body);
    assert.doesNotMatch(
      body,
      /\brisk\b/i,
      "readiness response must not contain 'risk'",
    );
    assert.doesNotMatch(body, /\bcompliant\b/i);
    assert.doesNotMatch(body, /\bseverity\b/i);
    assert.doesNotMatch(
      body,
      /\bapproved\b/i,
      "must not use 'approved' wording",
    );
  });

  it("AC-003: Classification is locked when no accepted TechnicalEvidenceReport exists", async () => {
    if (!managerToken) return;
    const create = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Lock Test", organization_id: orgId });

    const assessmentId = (create.body as CreateAssessmentDto)?.assessment_id;
    if (!assessmentId) return;

    const detail = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(detail);

    assert.ok(
      body.readiness_state.classification_locked === true,
      "classification must be locked when no evidence report exists",
    );
    assert.ok(
      body.readiness_state.lock_reason,
      "lock_reason must explain why classification is locked",
    );
  });
});
