import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
/**
 * MW-asmt-003: List Assessments Endpoint.
 */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { AssessmentListDto } from "../src/modules/assessment/application/contracts/assessment/assessment-list.contract.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

describe("List Assessments Endpoint (e2e) [MW-asmt-003]", () => {
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
    customerToken = successBody<SignInSuccess>(signIn).session_token ?? "";
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createAssessment(name: string) {
    await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name });
  }

  // T01
  it("T01: CUSTOMER with assessments -> 200, paginated list", async () => {
    await createAssessment("Assessment A");
    await createAssessment("Assessment B");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${customerToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.assessments.length, 2);
    assert.equal(body.total, 2);
    assert.equal(body.page, 1);
    assert.equal(body.page_size, 20);
    assert.ok(body.correlationId);
    body.assessments.forEach((item) => {
      assert.equal(typeof item.status, "string");
      assert.ok(item.assessment_id);
      assert.ok(item.created_at);
      assert.ok(item.updated_at);
    });
  });

  // T02
  it("T02: CUSTOMER with no assessments -> 200, empty array", async () => {
    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${customerToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.deepEqual(body.assessments, []);
    assert.equal(body.total, 0);
  });

  // T03
  it("T03: page_size=5 -> only 5 returned", async () => {
    for (let i = 0; i < 8; i += 1) {
      await createAssessment(`Assessment ${i}`);
    }

    const result = await httpRequest(app)
      .get("/assessments")
      .query({ page_size: 5 })
      .set("Authorization", `Bearer ${customerToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(body.assessments.length, 5);
    assert.equal(body.total, 8);
    assert.equal(body.page_size, 5);
  });

  // T04
  it("T04: status filter -> only matching status returned", async () => {
    await createAssessment("Matches Filter");

    const result = await httpRequest(app)
      .get("/assessments")
      .query({ status: ASSESSMENT_STATUS_CODES.wizardInProgress })
      .set("Authorization", `Bearer ${customerToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.ok(body.assessments.length >= 1);
    body.assessments.forEach((item) => {
      assert.equal(item.status, ASSESSMENT_STATUS_CODES.wizardInProgress);
    });
  });

  it("Unknown status filter -> 422 INVALID_REQUEST", async () => {
    const result = await httpRequest(app)
      .get("/assessments")
      .query({ status: "NOT_A_REAL_STATUS" })
      .set("Authorization", `Bearer ${customerToken}`);

    assert.equal(result.status, 422);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.invalidRequest);
  });

  // T05/T06: role-only RBAC permits ADMIN to reach list, then handler fails closed.
  it("ADMIN sees an empty assessment list", async () => {
    await createAssessment("Customer Owned 1");
    await createAssessment("Customer Owned 2");

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "nomembership@acme.test",
      password: "NoMembership123!",
    });
    const adminToken = successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(adminToken, "sign-in must succeed for admin fixture");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${adminToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.deepEqual(body.assessments, []);
    assert.equal(body.total, 0);
  });

  // T07
  it("T07: page_size > 100 -> clamped to 100", async () => {
    const result = await httpRequest(app)
      .get("/assessments")
      .query({ page_size: 500 })
      .set("Authorization", `Bearer ${customerToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.page_size, 100);
  });

  // T08
  it("T08: no risk labels in response", async () => {
    await createAssessment("Field Inspection Test");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${customerToken}`);

    const serialized = JSON.stringify(result.body).toLowerCase();
    assert.doesNotMatch(serialized, /\brisk\b/);
    assert.doesNotMatch(serialized, /\bseverity\b/);
    assert.doesNotMatch(serialized, /classification/);
  });
});
