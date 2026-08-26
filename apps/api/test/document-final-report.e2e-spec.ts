/** LCSP-81: Request Final Report Endpoint (e2e). */

import * as assert from "node:assert/strict";

import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_EVENT_TYPES,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
} from "@lcsp/contracts/document";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  OVERALL_COVERAGE_STATUSES,
  type ClassificationGuardrailStatus,
} from "@lcsp/contracts/scan";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import {
  toPrismaDocumentRequestStatus,
  toPrismaDocumentType,
  toPrismaOverallCoverageStatus,
} from "../src/infrastructure/prisma/prisma-enum-mappers.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedLegalClassificationParents,
  seedVerifiedProfileGraph,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

type SuccessResponse = {
  document_request_id: string;
  status: string;
  document_type: string;
  correlationId: string;
};

describe("Request Final Report Endpoint (e2e) [LCSP-81]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;

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
    await prisma.authAuditEvent.deleteMany({
      where: { eventType: DOCUMENT_EVENT_TYPES.finalReportRequestedAudit },
    });
    await prisma.outboxMessage.deleteMany({
      where: { eventType: DOCUMENT_EVENT_TYPES.finalReportRequested },
    });
    await prisma.documentRequest.deleteMany();
    await prisma.classificationResult.deleteMany();
    await prisma.legalRuleMatch.deleteMany();
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.assessment.create({
      data: {
        id: "assessment-1",
        ownerId: "user-1",
        name: "Final report assessment",
      },
    });
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    managerToken = successBody<SignInSuccess>(signIn).session_token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("returns QUEUED and writes document request, outbox, and audit when guardrail passed", async () => {
    await seedClassification(prisma, CLASSIFICATION_GUARDRAIL_STATUSES.passed);
    const response = await requestFinalReport(
      app,
      managerToken,
      "assessment-1",
    );
    const body = successBody<SuccessResponse>(response);
    assert.equal(response.status, 202);
    assert.ok(body.document_request_id);
    assert.equal(body.status, DOCUMENT_REQUEST_STATUSES.queued);
    assert.equal(body.document_type, DOCUMENT_TYPES.finalReport);
    assert.ok(body.correlationId);

    const [docRequest, outbox, auditCount] = await Promise.all([
      prisma.documentRequest.findUnique({
        where: { id: body.document_request_id },
      }),
      prisma.outboxMessage.findFirst({
        where: {
          eventType: DOCUMENT_EVENT_TYPES.finalReportRequested,
          aggregateType: OUTBOX_AGGREGATE_TYPES.documentRequest,
          aggregateId: body.document_request_id,
        },
      }),
      prisma.authAuditEvent.count({
        where: {
          eventType: DOCUMENT_EVENT_TYPES.finalReportRequestedAudit,
          correlationId: body.correlationId,
        },
      }),
    ]);
    assert.ok(docRequest);
    assert.equal(
      docRequest?.status,
      toPrismaDocumentRequestStatus(DOCUMENT_REQUEST_STATUSES.queued),
    );
    assert.equal(
      docRequest?.documentType,
      toPrismaDocumentType(DOCUMENT_TYPES.finalReport),
    );
    assert.ok(outbox);
    assert.equal(auditCount, 2);
  });

  it("returns 409 CLASSIFICATION_GUARDRAIL_NOT_PASSED when latest classification is degraded", async () => {
    await seedClassification(
      prisma,
      CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
    );
    const response = await requestFinalReport(
      app,
      managerToken,
      "assessment-1",
    );
    assert.equal(response.status, 409);
    assert.equal(
      problemCode(response),
      DOCUMENT_ERROR_CODES.classificationGuardrailNotPassed,
    );
    assert.equal(await prisma.documentRequest.count(), 0);
    assert.equal(
      await prisma.outboxMessage.count({
        where: { eventType: DOCUMENT_EVENT_TYPES.finalReportRequested },
      }),
      0,
    );
  });

  it("returns 409 DOCUMENT_ALREADY_QUEUED when a QUEUED request already exists", async () => {
    const { classificationResultId } = await seedClassification(
      prisma,
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    await prisma.documentRequest.create({
      data: {
        id: "doc-req-existing",
        assessmentId: "assessment-1",
        requestedById: "user-1",
        classificationResultId,
        documentType: toPrismaDocumentType(DOCUMENT_TYPES.finalReport),
        status: toPrismaDocumentRequestStatus(DOCUMENT_REQUEST_STATUSES.queued),
        correlationId: "corr-existing",
      },
    });
    const response = await requestFinalReport(
      app,
      managerToken,
      "assessment-1",
    );
    assert.equal(response.status, 409);
    assert.equal(problemCode(response), DOCUMENT_ERROR_CODES.alreadyQueued);
  });

  it("returns 404 ASSESSMENT_NOT_FOUND for a missing assessment", async () => {
    const response = await requestFinalReport(
      app,
      managerToken,
      "assessment-missing",
    );
    assert.equal(response.status, 404);
    assert.equal(
      problemCode(response),
      DOCUMENT_ERROR_CODES.assessmentNotFound,
    );
  });
});

function requestFinalReport(
  app: INestApplication,
  token: string,
  assessmentId: string,
) {
  return httpRequest(app)
    .post(`/assessments/${assessmentId}/documents/final-report`)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Correlation-Id", "doc-final-corr-1")
    .send({});
}

async function seedClassification(
  prisma: PrismaClient,
  guardrailStatus: ClassificationGuardrailStatus,
): Promise<{ classificationResultId: string }> {
  const matchId = `lrm-${guardrailStatus}`;
  const classificationResultId = `classification-${guardrailStatus}`;

  await seedVerifiedProfileGraph(prisma, { verifiedProfileId: "vp-1" });
  await seedLegalClassificationParents(prisma);

  await prisma.legalRuleMatch.create({
    data: {
      id: matchId,
      verifiedProfileId: "vp-1",
      assessmentId: "assessment-1",
      corpusVersionId: "LCSP-LEGAL-CORPUS-v0.1.0",
      legalRuleCatalogVersionId: "LCSP-RULE-CATALOG-v0.1.0",
      schemaVersion: "1.0.0",
      matches: [],
      citationAllowlist: ["chunk-1"],
      overallCoverageStatus: toPrismaOverallCoverageStatus(
        OVERALL_COVERAGE_STATUSES.completeCitation,
      ),
      guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
      status: CLASSIFICATION_RESULT_STATUSES.accepted,
    },
  });

  await prisma.classificationResult.create({
    data: {
      id: classificationResultId,
      legalRuleMatchId: matchId,
      verifiedProfileId: "vp-1",
      assessmentId: "assessment-1",
      schemaVersion: "1.0.0",
      classificationData: {
        system_type: "HIGH_IMPACT_AI",
        risk_level: "HIGH",
        citation_basis: ["chunk-1"],
      },
      guardrailStatus,
      blockedReason: null,
      status: CLASSIFICATION_RESULT_STATUSES.accepted,
    },
  });
  return { classificationResultId };
}
