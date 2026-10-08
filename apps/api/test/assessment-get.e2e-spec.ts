import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
/**
 * MW-asmt-002: Get Assessment Endpoint.
 * Role-only RBAC coverage for the current single-tenant assessment model.
 */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { CreateAssessmentDto } from "../src/modules/assessment/application/contracts/assessment/create-assessment.contract.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

describe("Get Assessment Endpoint (e2e) [MW-asmt-002]", () => {
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
    await prisma.classificationResult.deleteMany();
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.repositoryScanJob.deleteMany();
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    customerToken = successBody<SignInSuccess>(signIn).session_token ?? "";
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createAssessment(name = "Detail Test Assessment") {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name });
    return successBody<CreateAssessmentDto>(result).assessment_id;
  }

  it("CUSTOMER reads own assessment -> 200 with full state", async () => {
    const assessmentId = await createAssessment();

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${customerToken}`);
    const body = successBody<AssessmentDetail>(result);

    assert.equal(result.status, 200);
    assert.equal(body.assessment_id, assessmentId);
    assert.equal(body.name, "Detail Test Assessment");
    assert.equal(body.lifecycle?.state, ASSESSMENT_LIFECYCLE_STATES.PREPARING);
    assert.equal(body.owner_id, "user-1");
    assert.ok(body.created_at);
    assert.ok(body.updated_at);
    assert.ok(body.correlationId);
  });

  it("CUSTOMER cannot read another user's assessment -> 404", async () => {
    const otherOwnedId = "00000000-0000-4000-8000-000000000002";
    await prisma.assessment.create({
      data: {
        id: otherOwnedId,
        ownerId: "user-2",
        name: "Not Mine",
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
    });

    const result = await httpRequest(app)
      .get(`/assessments/${otherOwnedId}`)
      .set("Authorization", `Bearer ${customerToken}`);

    assert.equal(result.status, 404);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.notFound);
  });

  it("ADMIN reaches the read route but fails closed for customer-owned assessment", async () => {
    const assessmentId = await createAssessment();
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "nomembership@acme.test",
      password: "NoMembership123!",
    });
    const adminToken = successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(adminToken, "sign-in must succeed for admin fixture");

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(result.status, 404);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.notFound);
  });

  it("response has no risk/severity/non-compliant wording", async () => {
    const assessmentId = await createAssessment();

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${customerToken}`);

    const serialized = JSON.stringify(result.body).toLowerCase();
    assert.doesNotMatch(serialized, /\brisk\b/);
    assert.doesNotMatch(serialized, /\bseverity\b/);
    assert.doesNotMatch(serialized, /non-compliant/);
  });
});
