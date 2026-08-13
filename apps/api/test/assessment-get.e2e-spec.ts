import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LOCK_REASONS,
  ASSESSMENT_MISSING_EVIDENCE_CODES,
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
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_STATUSES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
} from "@lcsp/contracts/scan";
/**
 * MW-asmt-002: Get Assessment Endpoint.
 * Test cases T01-T08.
 */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import type { AssessmentDetailDto } from "../src/modules/assessment/application/contracts/assessment/assessment-detail.contract.js";
import type { CreateAssessmentDto } from "../src/modules/assessment/application/contracts/assessment/create-assessment.contract.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

describe("Get Assessment Endpoint (e2e) [MW-asmt-002]", () => {
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
    await prisma.classificationResult.deleteMany();
    await prisma.technicalEvidenceReport.deleteMany();
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

  async function createAssessment(name = "Detail Test Assessment") {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name });
    return successBody<CreateAssessmentDto>(result).assessment_id;
  }

  // T01
  it("T01: Manager reads own assessment -> 200 with full state", async () => {
    const assessmentId = await createAssessment();

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.assessment_id, assessmentId);
    assert.equal(body.name, "Detail Test Assessment");
    assert.equal(body.status, ASSESSMENT_STATUS_CODES.wizardInProgress);
    assert.equal(body.owner_id, "user-1");
    assert.equal(body.organization_id, orgId);
    assert.equal(body.wizard_status, WIZARD_STATUS_CODES.notStarted);
    assert.ok(body.created_at);
    assert.ok(body.updated_at);
    assert.ok(body.correlationId);
  });

  // T02
  it("T02: No technical evidence -> classification_locked=true, lock_reason=LOCKED_EVIDENCE_REQUIRED", async () => {
    const assessmentId = await createAssessment();

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.equal(body.readiness_state.classification_locked, true);
    assert.equal(
      body.readiness_state.lock_reason,
      ASSESSMENT_LOCK_REASONS.evidenceRequired,
    );
    assert.deepEqual(body.readiness_state.missing_evidence, [
      ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
    ]);
  });

  it("T03b: Rejected technical evidence keeps the assessment projection locked", async () => {
    const assessmentId = await createAssessment();
    await prisma.technicalEvidenceReport.create({
      data: {
        id: "rejected-evidence-report",
        scanJobId: "scan-job-rejected-evidence",
        assessmentId,
        snapshotId: "snapshot-rejected-evidence",
        organizationId: orgId,
        toolsVersion: { semgrep: "1.172.0" },
        configHash: { semgrep: "sha256:test" },
        evidencePayload: { findings: [] },
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        schemaVersion: "1.0.0",
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected,
      },
    });

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.equal(body.readiness_state.classification_locked, true);
    assert.equal(
      body.readiness_state.lock_reason,
      ASSESSMENT_LOCK_REASONS.evidenceRequired,
    );
    assert.deepEqual(body.readiness_state.missing_evidence, [
      ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
    ]);
  });

  it("T03: Accepted technical evidence unlocks the assessment projection", async () => {
    const assessmentId = await createAssessment();
    await prisma.technicalEvidenceReport.create({
      data: {
        id: "accepted-evidence-report",
        scanJobId: "scan-job-accepted-evidence",
        assessmentId,
        snapshotId: "snapshot-accepted-evidence",
        organizationId: orgId,
        toolsVersion: { semgrep: "1.172.0" },
        configHash: { semgrep: "sha256:test" },
        evidencePayload: { findings: [] },
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        schemaVersion: "1.0.0",
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
    });

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.equal(body.readiness_state.classification_locked, false);
    assert.equal(body.readiness_state.lock_reason, null);
    assert.deepEqual(body.readiness_state.missing_evidence, []);
  });

  it("T03c: Accepted classification result projects its guardrail status", async () => {
    const assessmentId = await createAssessment();
    await prisma.technicalEvidenceReport.create({
      data: {
        id: "accepted-evidence-for-classification",
        scanJobId: "scan-job-classification",
        assessmentId,
        snapshotId: "snapshot-classification",
        organizationId: orgId,
        toolsVersion: { semgrep: "1.172.0" },
        configHash: { semgrep: "sha256:test" },
        evidencePayload: { findings: [] },
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        schemaVersion: "1.0.0",
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
    });
    await prisma.classificationResult.create({
      data: {
        id: "classification-result-passed",
        assessmentId,
        organizationId: orgId,
        guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
        status: CLASSIFICATION_RESULT_STATUSES.accepted,
      },
    });

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.equal(
      body.guardrail_status,
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
  });

  // T04
  it("T04: Assessment not in session org -> 404 ASSESSMENT_NOT_FOUND", async () => {
    const otherOrgId = "org-other-asmt-get";
    await prisma.authOrganization.create({
      data: { id: otherOrgId, slug: "other-asmt-get", name: "Other Org" },
    });
    const foreignAssessmentId = "assessment-foreign-org";
    await prisma.assessment.create({
      data: {
        id: foreignAssessmentId,
        organizationId: otherOrgId,
        ownerId: "someone-else",
        name: "Foreign Assessment",
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
    });

    const result = await httpRequest(app)
      .get(`/assessments/${foreignAssessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 404);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.notFound);
  });

  it("T04b: Manager cannot read another Manager's assessment in the same org -> 404", async () => {
    const otherOwnedId = "assessment-other-owner";
    await prisma.assessment.create({
      data: {
        id: otherOwnedId,
        organizationId: orgId,
        ownerId: "some-other-manager",
        name: "Not Mine",
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
    });

    const result = await httpRequest(app)
      .get(`/assessments/${otherOwnedId}`)
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 404);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.notFound);
  });

  // T05
  it("T05: Manager lacks assessment:read -> 403 PBAC_DENIED", async () => {
    const assessmentId = await createAssessment();

    const restrictedPolicyId = "policy-no-assessment-read";
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
    const restrictedUserId = "user-no-assessment-read";
    await prisma.authUser.create({
      data: {
        id: restrictedUserId,
        email: "restricted-read@acme.test",
        passwordHash: hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-no-assessment-read",
        userId: restrictedUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId: restrictedPolicyId,
        policyVersion: "2026-07-10",
      },
    });
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "restricted-read@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    const restrictedToken =
      successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(restrictedToken, "sign-in must succeed for restricted fixture");

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${restrictedToken}`);

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), PBAC_REASON_CODE.denied);
  });

  // T06
  it("T06: response has no risk/severity/non-compliant wording", async () => {
    const assessmentId = await createAssessment();

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);

    const serialized = JSON.stringify(result.body).toLowerCase();
    assert.doesNotMatch(serialized, /\brisk\b/);
    assert.doesNotMatch(serialized, /\bseverity\b/);
    assert.doesNotMatch(serialized, /non-compliant/);
    assert.doesNotMatch(serialized, /\bhigh\b|\bmedium\b|\blow\b/);
  });

  // T07
  it("T07: Developer with assessment:read scope -> 200 with scoped projection", async () => {
    const assessmentId = await createAssessment();

    const devPolicyId = "policy-developer-read";
    await prisma.authPolicy.create({
      data: {
        id: devPolicyId,
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.assessmentRead],
        subjectRole: SUBJECT_ROLES.developer,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const devUserId = "user-developer-read";
    await prisma.authUser.create({
      data: {
        id: devUserId,
        email: "developer-read@acme.test",
        passwordHash: hashSecret("DevPassword123!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-developer-read",
        userId: devUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId: devPolicyId,
        policyVersion: "2026-07-10",
      },
    });
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "developer-read@acme.test",
      password: "DevPassword123!",
      organization_id: orgId,
    });
    const devToken = successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(devToken, "sign-in must succeed for developer fixture");

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${devToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.assessment_id, assessmentId);
  });

  // T08
  it("T08: next_action is business language", async () => {
    const assessmentId = await createAssessment();

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.ok(body.next_action.length > 0);
    assert.doesNotMatch(
      body.next_action.toLowerCase(),
      /\brisk\b|\bseverity\b/,
    );
  });

  it("wizard_status reflects an existing WizardProfile row", async () => {
    const assessmentId = await createAssessment();
    await prisma.wizardProfile.create({
      data: {
        id: "wizard-profile-1",
        assessmentId,
        organizationId: orgId,
        ownerId: "user-1",
        status: WIZARD_STATUS_CODES.inProgress,
        answers: {},
      },
    });

    const result = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetailDto>(result);

    assert.equal(body.wizard_status, WIZARD_STATUS_CODES.inProgress);
  });
});
