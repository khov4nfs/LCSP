/** MW-cls-001: LegalRuleMatch Callback Endpoint. */

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
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_SCHEMA_VERSIONS,
  OVERALL_COVERAGE_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
import { fromPrismaOverallCoverageStatus } from "../src/infrastructure/prisma/prisma-enum-mappers.js";
import type {
  AcceptLegalRuleMatchDto,
  LegalRuleMatchCallbackResponseDto,
} from "../src/modules/classification/application/contracts/classification/legal-rule-match-callback.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("LegalRuleMatch Callback Endpoint (e2e) [MW-cls-001]", () => {
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
    await seedAssessmentAndVerifiedProfile(
      prisma,
      "assessment-1",
      "org-1",
      "vp-1",
    );
    await seedApprovedLegalAssets(prisma);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("T01/T07 accepts valid matches with allowlisted citations, emits ready event and audit log", async () => {
    const response = await callback(app, validPayload());
    const body = successBody<LegalRuleMatchCallbackResponseDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(
      body.guardrail_status,
      LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
    );
    assert.ok(body.legal_rule_match_id);

    const [ruleMatch, outbox, audit] = await Promise.all([
      prisma.legalRuleMatch.findUnique({
        where: { id: body.legal_rule_match_id },
      }),
      prisma.outboxMessage.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.legalRuleMatchReady },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.legalRuleMatchAcceptedAudit },
      }),
    ]);

    assert.equal(ruleMatch?.verifiedProfileId, "vp-1");
    assert.equal(ruleMatch?.assessmentId, "assessment-1");
    assert.equal(ruleMatch?.organizationId, "org-1");
    assert.equal(
      ruleMatch?.guardrailStatus,
      LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
    );
    assert.equal(
      ruleMatch?.overallCoverageStatus
        ? fromPrismaOverallCoverageStatus(ruleMatch.overallCoverageStatus)
        : null,
      OVERALL_COVERAGE_STATUSES.completeCitation,
    );
    assert.equal(outbox?.aggregateId, body.legal_rule_match_id);
    assert.equal(
      (outbox?.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(audit?.resourceId, body.legal_rule_match_id);
    assert.equal(
      (audit?.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit?.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
  });

  it("T02 handles empty matches by accepting but setting guardrail_status = blocked", async () => {
    const emptyPayload: AcceptLegalRuleMatchDto = {
      ...validPayload(),
      matches: [],
      overall_coverage_status: OVERALL_COVERAGE_STATUSES.noCitation,
    };

    const response = await callback(app, emptyPayload);
    const body = successBody<LegalRuleMatchCallbackResponseDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(
      body.guardrail_status,
      LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked,
    );

    const ruleMatch = await prisma.legalRuleMatch.findUnique({
      where: { id: body.legal_rule_match_id },
    });
    assert.equal(
      ruleMatch?.guardrailStatus,
      LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked,
    );
    assert.equal(ruleMatch?.blockedReason, "NO_CITATION_BASIS");

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: SCAN_EVENT_TYPES.legalRuleMatchBlockedAudit },
    });
    assert.ok(audit);
  });

  it("T03 rejects citation chunk not in allowlist with 422 CITATION_OUT_OF_ALLOWLIST", async () => {
    const invalidPayload: AcceptLegalRuleMatchDto = {
      ...validPayload(),
      citation_allowlist: ["chunk-1"], // missing chunk-2
    };

    const response = await callback(app, invalidPayload);

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.citationOutOfAllowlist,
    );
    assert.equal(await prisma.legalRuleMatch.count(), 0);
  });

  it("T04 rejects unapproved corpus version with 422 CORPUS_VERSION_NOT_APPROVED", async () => {
    const response = await callback(
      app,
      validPayload({ corpus_version_id: "unapproved-corpus-v0" }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.corpusVersionNotApproved,
    );
  });

  it("T04b rejects unapproved rule catalog version with 422 RULE_CATALOG_VERSION_NOT_APPROVED", async () => {
    const response = await callback(
      app,
      validPayload({ legal_rule_catalog_version_id: "unapproved-catalog-v0" }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.ruleCatalogVersionNotApproved,
    );
  });

  it("T04c rejects citation chunk with legal_status = REPEALED with 422 CITATION_REPEALED", async () => {
    const payload = validPayload();
    payload.matches[0].legal_status = "REPEALED";

    const response = await callback(app, payload);

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.citationRepealed,
    );
  });

  it("T04d rejects legal matching for a pending VerifiedProfile", async () => {
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
    assert.equal(await prisma.legalRuleMatch.count(), 0);
  });

  it("T05 preserves distinct PRIMARY_MATCH and REFERENCED_CONTEXT match types", async () => {
    const response = await callback(app, validPayload());
    const body = successBody<LegalRuleMatchCallbackResponseDto>(response);

    const ruleMatch = await prisma.legalRuleMatch.findUnique({
      where: { id: body.legal_rule_match_id },
    });
    const matches =
      ruleMatch?.matches as unknown as AcceptLegalRuleMatchDto["matches"];

    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.match_type, "PRIMARY_MATCH");
    assert.equal(matches[1]?.match_type, "REFERENCED_CONTEXT");
  });

  it("T06 rejects invalid worker API key with 401 Unauthorized", async () => {
    const response = await httpRequest(app)
      .post("/internal/classification/legal-rule-match-callback")
      .set("X-Worker-Api-Key", "invalid-key")
      .send(validPayload());

    assert.equal(response.status, 401);
    assert.equal(await prisma.legalRuleMatch.count(), 0);
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
});

function callback(app: INestApplication, payload: AcceptLegalRuleMatchDto) {
  return httpRequest(app)
    .post("/internal/classification/legal-rule-match-callback")
    .set("X-Worker-Api-Key", WORKER_KEY)
    .set("X-Correlation-Id", "lrm-corr-1")
    .send(payload);
}

function validPayload(
  overrides: Partial<AcceptLegalRuleMatchDto> = {},
): AcceptLegalRuleMatchDto {
  return {
    verified_profile_id: "vp-1",
    assessment_id: "assessment-1",
    corpus_version_id: "corpus-v1",
    legal_rule_catalog_version_id: "catalog-v1",
    schema_version: LEGAL_RULE_MATCH_SCHEMA_VERSIONS[0],
    citation_allowlist: ["chunk-1", "chunk-2"],
    overall_coverage_status: OVERALL_COVERAGE_STATUSES.completeCitation,
    matches: [
      {
        match_id: "match-1",
        rule_id: "AI-HIGH-IMPACT-01",
        legal_rule_catalog_version_id: "catalog-v1",
        article_ref: "Art. 1",
        clause_ref: "Cl. 2",
        match_type: "PRIMARY_MATCH",
        citation_chunk_ids: ["chunk-1"],
        confidence: 0.95,
        coverage_status: OVERALL_COVERAGE_STATUSES.completeCitation,
        usage_claim_ref: "claim-1",
      },
      {
        match_id: "match-2",
        rule_id: "AI-HIGH-IMPACT-02",
        legal_rule_catalog_version_id: "catalog-v1",
        article_ref: "Art. 5",
        clause_ref: "Cl. 1",
        match_type: "REFERENCED_CONTEXT",
        citation_chunk_ids: ["chunk-2"],
        confidence: 0.85,
        coverage_status: OVERALL_COVERAGE_STATUSES.completeCitation,
        usage_claim_ref: "claim-2",
      },
    ],
    ...overrides,
  };
}

async function resetDomainData(prisma: PrismaClient): Promise<void> {
  await prisma.legalRuleMatch.deleteMany();
  await prisma.verifiedProfile.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.legalRuleCatalogVersion.deleteMany();
  await prisma.corpusApprovalRecord.deleteMany();
  await prisma.legalDocumentChunk.deleteMany();
  await prisma.legalSourceDocument.deleteMany();
  await prisma.legalCorpusVersion.deleteMany();
}

async function seedApprovedLegalAssets(prisma: PrismaClient): Promise<void> {
  await prisma.legalCorpusVersion.create({
    data: {
      id: "corpus-v1",
      version: "corpus-v1",
      status: "APPROVED",
      sourceManifest: {},
      approvedAt: new Date(),
    },
  });
  await prisma.legalRuleCatalogVersion.create({
    data: {
      id: "catalog-v1",
      version: "catalog-v1",
      status: "APPROVED",
      ruleRefs: [],
      approvedAt: new Date(),
    },
  });
}

async function seedAssessmentAndVerifiedProfile(
  prisma: PrismaClient,
  assessmentId: string,
  organizationId: string,
  verifiedProfileId: string,
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
