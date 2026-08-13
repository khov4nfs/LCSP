import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
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
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

describe("List Assessments Endpoint (e2e) [MW-asmt-003]", () => {
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
    await prisma.wizardProfile.deleteMany();
    await prisma.assessment.deleteMany();
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

  async function createAssessment(name: string) {
    await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name });
  }

  // T01
  it("T01: Manager with assessments -> 200, paginated list", async () => {
    await createAssessment("Assessment A");
    await createAssessment("Assessment B");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.assessments.length, 2);
    assert.equal(body.total, 2);
    assert.equal(body.page, 1);
    assert.equal(body.page_size, 20);
    assert.ok(body.correlationId);
    body.assessments.forEach((item) => {
      assert.equal(item.wizard_status, WIZARD_STATUS_CODES.notStarted);
      assert.ok(item.assessment_id);
      assert.ok(item.created_at);
      assert.ok(item.updated_at);
    });
  });

  // T02
  it("T02: Manager with no assessments -> 200, empty array", async () => {
    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${managerToken}`);
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
      .set("Authorization", `Bearer ${managerToken}`);
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
      .set("Authorization", `Bearer ${managerToken}`);
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
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 422);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.invalidRequest);
  });

  // T05
  it("T05: Manager lacks assessment:list -> 403 PBAC_DENIED", async () => {
    const restrictedPolicyId = "policy-no-assessment-list";
    await prisma.authPolicy.create({
      data: {
        id: restrictedPolicyId,
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.workspaceRead, ASSESSMENT_ACTIONS.create],
        subjectRole: SUBJECT_ROLES.manager,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const restrictedUserId = "user-no-assessment-list";
    await prisma.authUser.create({
      data: {
        id: restrictedUserId,
        email: "restricted-list@acme.test",
        passwordHash: hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-no-assessment-list",
        userId: restrictedUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId: restrictedPolicyId,
        policyVersion: "2026-07-10",
      },
    });
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "restricted-list@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    const restrictedToken =
      successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(restrictedToken, "sign-in must succeed for restricted fixture");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${restrictedToken}`);

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), PBAC_REASON_CODE.denied);
  });

  // T06
  it("T06: Developer sees only their scoped assessment", async () => {
    await createAssessment("Manager Owned 1");
    await createAssessment("Manager Owned 2");

    const scopedAssessment = await prisma.assessment.create({
      data: {
        id: "assessment-dev-scoped",
        organizationId: orgId,
        ownerId: "user-1",
        name: "Developer Scoped Assessment",
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
    });

    const devPolicyId = "policy-developer-list";
    await prisma.authPolicy.create({
      data: {
        id: devPolicyId,
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.assessmentList],
        subjectRole: SUBJECT_ROLES.developer,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const devUserId = "user-developer-list";
    await prisma.authUser.create({
      data: {
        id: devUserId,
        email: "developer-list@acme.test",
        passwordHash: hashSecret("DevPassword123!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-developer-list",
        userId: devUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: {
          role: SUBJECT_ROLES.developer,
          scope: scopedAssessment.id,
        },
        policyId: devPolicyId,
        policyVersion: "2026-07-10",
      },
    });
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "developer-list@acme.test",
      password: "DevPassword123!",
      organization_id: orgId,
    });
    const devToken = successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(devToken, "sign-in must succeed for developer fixture");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${devToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.assessments.length, 1);
    assert.equal(body.assessments[0].assessment_id, scopedAssessment.id);
  });

  it("Developer with no scope sees an empty list", async () => {
    await createAssessment("Manager Owned");

    const devPolicyId = "policy-developer-no-scope";
    await prisma.authPolicy.create({
      data: {
        id: devPolicyId,
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.assessmentList],
        subjectRole: SUBJECT_ROLES.developer,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const devUserId = "user-developer-no-scope";
    await prisma.authUser.create({
      data: {
        id: devUserId,
        email: "developer-no-scope@acme.test",
        passwordHash: hashSecret("DevPassword123!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-developer-no-scope",
        userId: devUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId: devPolicyId,
        policyVersion: "2026-07-10",
      },
    });
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "developer-no-scope@acme.test",
      password: "DevPassword123!",
      organization_id: orgId,
    });
    const devToken = successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(devToken, "sign-in must succeed for developer fixture");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${devToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.deepEqual(body.assessments, []);
  });

  // T07
  it("T07: page_size > 100 -> clamped to 100", async () => {
    const result = await httpRequest(app)
      .get("/assessments")
      .query({ page_size: 500 })
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentListDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.page_size, 100);
  });

  // T08
  it("T08: no risk labels in response", async () => {
    await createAssessment("Field Inspection Test");

    const result = await httpRequest(app)
      .get("/assessments")
      .set("Authorization", `Bearer ${managerToken}`);

    const serialized = JSON.stringify(result.body).toLowerCase();
    assert.doesNotMatch(serialized, /\brisk\b/);
    assert.doesNotMatch(serialized, /\bseverity\b/);
    assert.doesNotMatch(serialized, /classification/);
  });
});
