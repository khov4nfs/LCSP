/** MW-cls-002: Classification Result Callback Endpoint. */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import { OUTBOX_MESSAGE_SCHEMA_VERSION } from "@lcsp/contracts/outbox";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_STATUSES,
  CLASSIFICATION_RESULT_SCHEMA_VERSIONS,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_STATUSES,
  OVERALL_COVERAGE_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
import { toPrismaOverallCoverageStatus } from "../src/infrastructure/prisma/prisma-enum-mappers.js";
import type {
  AcceptClassificationDto,
  ClassificationResultCallbackResponseDto,
} from "../src/modules/classification/application/contracts/classification/classification-result-callback.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("Classification Result Callback Endpoint (e2e) [MW-cls-002]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_KEY;
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
    await resetDomainData(prisma);
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await seedAssessmentVerifiedProfileAndMatch(
      prisma,
      "assessment-1",
      "org-1",
      "vp-1",
      "lrm-1",
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("T01/T07 accepts valid classification result, emits ready event and audit log", async () => {
    const response = await callback(app, validPayload());
    const body = successBody<ClassificationResultCallbackResponseDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(
      body.guardrail_status,
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    assert.ok(body.classification_result_id);

    const [clsResult, outbox, audit] = await Promise.all([
      prisma.classificationResult.findUnique({
        where: { id: body.classification_result_id },
      }),
      prisma.outboxMessage.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.classificationResultReady },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.classificationAcceptedAudit },
      }),
    ]);

    assert.equal(clsResult?.legalRuleMatchId, "lrm-1");
    assert.equal(clsResult?.verifiedProfileId, "vp-1");
    assert.equal(clsResult?.assessmentId, "assessment-1");
    assert.equal(clsResult?.organizationId, "org-1");
    assert.equal(
      clsResult?.schemaVersion,
      CLASSIFICATION_RESULT_SCHEMA_VERSIONS[0],
    );
    assert.deepEqual(clsResult?.classificationData, {
      system_type: "HIGH_IMPACT_AI",
      risk_level: "HIGH",
      citation_basis: ["chunk-1"],
    });
    assert.equal(
      clsResult?.guardrailStatus,
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    assert.equal(clsResult?.blockedReason, null);
    assert.equal(clsResult?.status, CLASSIFICATION_RESULT_STATUSES.accepted);
    assert.equal(outbox?.aggregateId, body.classification_result_id);
    assert.equal(
      (outbox?.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(audit?.resourceId, body.classification_result_id);
    assert.equal(
      (audit?.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit?.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
  });

  it("T02 accepts degraded guardrail_status", async () => {
    const degradedPayload: AcceptClassificationDto = {
      ...validPayload(),
      guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
    };

    const response = await callback(app, degradedPayload);
    const body = successBody<ClassificationResultCallbackResponseDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(
      body.guardrail_status,
      CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
    );

    const clsResult = await prisma.classificationResult.findUnique({
      where: { id: body.classification_result_id },
    });
    assert.equal(
      clsResult?.guardrailStatus,
      CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
    );
  });

  it("T03 accepts blocked guardrail_status with blocked audit decision", async () => {
    const blockedPayload: AcceptClassificationDto = {
      ...validPayload(),
      guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
    };

    const response = await callback(app, blockedPayload);
    const body = successBody<ClassificationResultCallbackResponseDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(
      body.guardrail_status,
      CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
    );

    const clsResult = await prisma.classificationResult.findUnique({
      where: { id: body.classification_result_id },
    });
    assert.equal(
      clsResult?.guardrailStatus,
      CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
    );

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: SCAN_EVENT_TYPES.classificationBlockedAudit },
    });
    assert.ok(audit);
  });

  it("T04 rejects overclaim wording with 422 CLASSIFICATION_OVERCLAIM", async () => {
    const overclaimPayload: AcceptClassificationDto = {
      ...validPayload(),
      classification_data: {
        system_type: "HIGH_RISK",
        notes: "This model is certified compliant for production",
      },
    };

    const response = await callback(app, overclaimPayload);

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.classificationOverclaim,
    );
    assert.equal(await prisma.classificationResult.count(), 0);
  });

  it("T05 rejects when LegalRuleMatch has guardrailStatus = blocked", async () => {
    await prisma.legalRuleMatch.update({
      where: { id: "lrm-1" },
      data: { guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked },
    });

    const response = await callback(app, validPayload());

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.legalRuleMatchNotFound,
    );
  });

  it("T05b rejects classification result for a pending VerifiedProfile", async () => {
    await prisma.verifiedProfile.update({
      where: { id: "vp-1" },
      data: { status: VERIFIED_PROFILE_STATUSES.pendingApproval },
    });

    const response = await callback(app, validPayload());

    assertError(
      response.status,
      response.body,
      404,
      SCAN_ERROR_CODES.verifiedProfileNotFound,
    );
    assert.equal(await prisma.classificationResult.count(), 0);
  });

  it("T06 rejects duplicate result for same match with 409 RESULT_ALREADY_EXISTS", async () => {
    const firstRes = await callback(app, validPayload());
    assert.equal(firstRes.status, 200);

    const secondRes = await callback(app, validPayload());

    assertError(
      secondRes.status,
      secondRes.body,
      409,
      SCAN_ERROR_CODES.resultAlreadyExists,
    );
  });

  it("rejects non-existent LegalRuleMatch with 404 LEGAL_RULE_MATCH_NOT_FOUND", async () => {
    const response = await callback(
      app,
      validPayload({ legal_rule_match_id: "non-existent-lrm" }),
    );

    assertError(
      response.status,
      response.body,
      404,
      SCAN_ERROR_CODES.legalRuleMatchNotFound,
    );
  });

  it("rejects non-existent VerifiedProfile with 404 VERIFIED_PROFILE_NOT_FOUND", async () => {
    const response = await callback(
      app,
      validPayload({ verified_profile_id: "non-existent-vp" }),
    );

    assertError(
      response.status,
      response.body,
      404,
      SCAN_ERROR_CODES.verifiedProfileNotFound,
    );
  });

  it("T08 rejects invalid worker API key with 401 Unauthorized", async () => {
    const response = await httpRequest(app)
      .post("/internal/classification/result-callback")
      .set("X-Worker-Api-Key", "invalid-key")
      .send(validPayload());

    assert.equal(response.status, 401);
    assert.equal(await prisma.classificationResult.count(), 0);
  });
});

function callback(app: INestApplication, payload: AcceptClassificationDto) {
  return httpRequest(app)
    .post("/internal/classification/result-callback")
    .set("X-Worker-Api-Key", WORKER_KEY)
    .set("X-Correlation-Id", "cls-corr-1")
    .send(payload);
}

function validPayload(
  overrides: Partial<AcceptClassificationDto> = {},
): AcceptClassificationDto {
  return {
    legal_rule_match_id: "lrm-1",
    verified_profile_id: "vp-1",
    assessment_id: "assessment-1",
    schema_version: CLASSIFICATION_RESULT_SCHEMA_VERSIONS[0],
    classification_data: {
      system_type: "HIGH_IMPACT_AI",
      risk_level: "HIGH",
      citation_basis: ["chunk-1"],
    },
    guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    ...overrides,
  };
}

async function resetDomainData(prisma: PrismaClient): Promise<void> {
  await prisma.classificationResult.deleteMany();
  await prisma.legalRuleMatch.deleteMany();
  await prisma.verifiedProfile.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.assessment.deleteMany();
}

async function seedAssessmentVerifiedProfileAndMatch(
  prisma: PrismaClient,
  assessmentId: string,
  organizationId: string,
  verifiedProfileId: string,
  legalRuleMatchId: string,
): Promise<void> {
  await prisma.assessment.create({
    data: {
      id: assessmentId,
      organizationId,
      ownerId: "user-1",
      name: `Assessment ${assessmentId}`,
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
    },
  });

  await prisma.verifiedProfile.create({
    data: {
      id: verifiedProfileId,
      aiUsageFlowId: `ai-flow-${assessmentId}`,
      assessmentId,
      organizationId,
      schemaVersion: "1.0.0",
      providerVersion: "verified-profile-worker@1.0.0",
      profileData: { verified: true },
      gatesPassedAt: { test: new Date().toISOString() },
      status: VERIFIED_PROFILE_STATUSES.approved,
      approvedAt: new Date(),
      approvedById: "user-1",
    },
  });

  await prisma.legalRuleMatch.create({
    data: {
      id: legalRuleMatchId,
      verifiedProfileId,
      assessmentId,
      organizationId,
      corpusVersionId: "LCSP-LEGAL-CORPUS-v0.1.0",
      legalRuleCatalogVersionId: "LCSP-RULE-CATALOG-v0.1.0",
      schemaVersion: "1.0.0",
      matches: [],
      citationAllowlist: ["chunk-1"],
      overallCoverageStatus: toPrismaOverallCoverageStatus(
        OVERALL_COVERAGE_STATUSES.completeCitation,
      ),
      guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
      status: LEGAL_RULE_MATCH_STATUSES.accepted,
    },
  });
}

function assertError(
  actualStatus: number,
  body: unknown,
  expectedStatus: number,
  expectedCode: string,
): void {
  assert.equal(actualStatus, expectedStatus);
  assert.equal(problemCode(body), expectedCode);
}
