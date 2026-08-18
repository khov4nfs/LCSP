/** Direct EngineeringRule assessment callback endpoint. */

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
  ASSESSMENT_RESULT_MODES,
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_STATUSES,
  ENGINEERING_LIMITATION_CODES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
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

describe("Direct EngineeringRule Result Callback (e2e)", () => {
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
    await seedAssessmentAndEvidence(prisma);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("accepts EngineeringRule evaluations directly from TechnicalEvidenceReport", async () => {
    const response = await callback(app, validPayload());
    const body = successBody<ClassificationResultCallbackResponseDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(
      body.guardrail_status,
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    assert.ok(body.classification_result_id);

    const [result, outbox, audit] = await Promise.all([
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

    assert.equal(result?.legalRuleMatchId, null);
    assert.equal(result?.verifiedProfileId, null);
    assert.equal(result?.assessmentId, "assessment-1");
    assert.equal(result?.organizationId, "org-1");
    assert.equal(result?.schemaVersion, "2.0.0");
    assert.equal(result?.status, CLASSIFICATION_RESULT_STATUSES.accepted);
    assert.equal(
      result?.guardrailStatus,
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );

    const data = result?.classificationData as Record<string, unknown>;
    assert.equal(data.mode, ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation);
    assert.equal(data.technical_evidence_report_id, "ter-1");
    assert.equal(data.snapshot_id, "snapshot-1");

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

  it("accepts degraded result when one or more EngineeringRules are UNKNOWN", async () => {
    const payload: AcceptClassificationDto = {
      ...validPayload(),
      guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
      classification_data: {
        ...validPayload().classification_data,
        status: "PARTIAL",
        summary: { compliant: 0, non_compliant: 0, unknown: 1, total: 1 },
        evaluations: [
          {
            engineering_rule_id: "eng-1",
            legal_rule_id: "legal-1",
            concept: "HUMAN_REVIEW",
            status: "UNKNOWN",
            reason: "Repository evidence is insufficient.",
            evidence_refs: [],
            source_chunk_ids: ["LAW:A1"],
            source_locators: ["art-1::cl-1"],
            confidence: 0,
            limitations: [ENGINEERING_LIMITATION_CODES.dynamicPathUnresolved],
          },
        ],
      },
    };

    const response = await callback(app, payload);
    assert.equal(response.status, 200);
    const body = successBody<ClassificationResultCallbackResponseDto>(response);
    assert.equal(
      body.guardrail_status,
      CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
    );
  });

  it("accepts blocked runtime result without fabricating compliance findings", async () => {
    const payload: AcceptClassificationDto = {
      ...validPayload(),
      guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
      classification_data: {
        mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
        status: "BLOCKED",
        summary: { compliant: 0, non_compliant: 0, unknown: 0, total: 0 },
        evaluations: [],
        limitations: [
          ENGINEERING_LIMITATION_CODES.noEngineeringRuleSourceRules,
        ],
      },
    };

    const response = await callback(app, payload);
    const body = successBody<ClassificationResultCallbackResponseDto>(response);
    assert.equal(response.status, 200);
    assert.equal(
      body.guardrail_status,
      CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
    );

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: SCAN_EVENT_TYPES.classificationBlockedAudit },
    });
    assert.ok(audit);
  });

  it("rejects narrative legal/compliance overclaim wording", async () => {
    const payload: AcceptClassificationDto = {
      ...validPayload(),
      classification_data: {
        ...validPayload().classification_data,
        notes: "This system is certified and legally compliant.",
      },
    };

    const response = await callback(app, payload);
    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.classificationOverclaim,
    );
    assert.equal(await prisma.classificationResult.count(), 0);
  });

  it("rejects free-form prose in machine limitation fields", async () => {
    const payload = validPayload();
    const evaluations = payload.classification_data.evaluations as Array<
      Record<string, unknown>
    >;
    payload.classification_data = {
      ...payload.classification_data,
      evaluations: [
        {
          ...evaluations[0],
          limitations: ["System appears compliant based on external evidence."],
        },
      ],
    };

    const response = await callback(app, payload);
    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.classificationSchemaInvalid,
    );
    assert.equal(await prisma.classificationResult.count(), 0);
  });

  it("rejects a missing accepted TechnicalEvidenceReport", async () => {
    const response = await callback(app, {
      ...validPayload(),
      technical_evidence_report_id: "missing-ter",
    });

    assertError(
      response.status,
      response.body,
      404,
      SCAN_ERROR_CODES.evidenceReportNotFound,
    );
    assert.equal(await prisma.classificationResult.count(), 0);
  });

  it("rejects duplicate result for the same evidence report", async () => {
    assert.equal((await callback(app, validPayload())).status, 200);
    const second = await callback(app, validPayload());
    assertError(
      second.status,
      second.body,
      409,
      SCAN_ERROR_CODES.resultAlreadyExists,
    );
  });

  it("rejects invalid worker API key", async () => {
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
    .set("X-Correlation-Id", "engineering-corr-1")
    .send(payload);
}

function validPayload(): AcceptClassificationDto {
  return {
    technical_evidence_report_id: "ter-1",
    assessment_id: "assessment-1",
    schema_version: "2.0.0",
    classification_data: {
      mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
      status: "COMPLETE",
      legal_rule_catalog_version_id: "catalog-1",
      legal_corpus_version_id: "corpus-1",
      summary: { compliant: 1, non_compliant: 1, unknown: 0, total: 2 },
      evaluations: [
        {
          engineering_rule_id: "eng-review",
          legal_rule_id: "legal-review",
          concept: "HUMAN_REVIEW",
          status: "NON_COMPLIANT",
          reason:
            "Repository evidence demonstrates that the engineering requirement is not met.",
          evidence_refs: ["graph:path:1"],
          source_chunk_ids: ["LAW:A1"],
          source_locators: ["art-1::cl-1"],
          confidence: 0.95,
          limitations: [],
        },
        {
          engineering_rule_id: "eng-log",
          legal_rule_id: "legal-log",
          concept: "INCIDENT_LOGGING",
          status: "COMPLIANT",
          reason:
            "Repository evidence demonstrates that the engineering requirement is met.",
          evidence_refs: ["graph:path:2"],
          source_chunk_ids: ["LAW:A2"],
          source_locators: ["art-2::cl-1"],
          confidence: 0.9,
          limitations: [],
        },
      ],
      limitations: [],
    },
    guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
  };
}

async function resetDomainData(prisma: PrismaClient): Promise<void> {
  await prisma.classificationResult.deleteMany();
  await prisma.technicalEvidenceReport.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.assessment.deleteMany();
}

async function seedAssessmentAndEvidence(prisma: PrismaClient): Promise<void> {
  await prisma.assessment.create({
    data: {
      id: "assessment-1",
      organizationId: "org-1",
      ownerId: "user-1",
      name: "Direct Engineering Assessment",
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
    },
  });
  await prisma.technicalEvidenceReport.create({
    data: {
      id: "ter-1",
      scanJobId: "scan-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      snapshotId: "snapshot-1",
      toolsVersion: { scanner: "test" },
      configHash: { scanner: "sha256:test" },
      evidencePayload: { evidence_graph: { graph_id: "graph-1" } },
      privacyFlags: {},
      schemaVersion: "1.0.0",
      status: CLASSIFICATION_RESULT_STATUSES.accepted,
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
