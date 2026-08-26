/** MW-doc-003: Document Status and Download Endpoint (e2e). */

import * as assert from "node:assert/strict";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
  type DocumentRequestStatus,
  type DocumentType,
} from "@lcsp/contracts/document";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  OVERALL_COVERAGE_STATUSES,
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
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedLegalClassificationParents,
  seedVerifiedProfileGraph,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

type SuccessResponse = {
  document_request_id: string;
  document_type: string;
  status: string;
  blocked_reason: string | null;
  guardrail_status: string | null;
  download_url: string | null;
  download_url_expires_at: string | null;
  requested_at: string;
  completed_at: string | null;
  correlationId: string;
};

describe("Document Status Endpoint (e2e) [MW-doc-003]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET =
      "document-status-test-secret";
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
    await prisma.documentRequest.deleteMany();
    await prisma.classificationResult.deleteMany();
    await prisma.legalRuleMatch.deleteMany();
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    enableManagerDocumentRead(prisma);
    await seedLegalClassificationParents(prisma);
    await seedVerifiedProfileGraph(prisma, { verifiedProfileId: "vp-1" });

    await prisma.assessment.update({
      where: { id: "assessment-1" },
      data: { name: "Document status assessment" },
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: "org-1",
    });
    managerToken = successBody<SignInSuccess>(signIn).session_token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T04 returns READY with a 5-minute signed download url and redirects download", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-ready-1",
      status: DOCUMENT_REQUEST_STATUSES.ready,
      documentType: DOCUMENT_TYPES.gapAnalysis,
      documentUrl: "https://example.test/files/gap-analysis.pdf",
    });

    const response = await getDocumentStatus(app, managerToken, "doc-ready-1");
    const body = successBody<SuccessResponse>(response);

    assert.equal(response.status, 200);
    assert.equal(body.status, DOCUMENT_REQUEST_STATUSES.ready);
    assert.equal(body.document_type, DOCUMENT_TYPES.gapAnalysis);
    assert.ok(body.download_url);
    assert.ok(body.download_url_expires_at);

    const expiresAt = Date.parse(body.download_url_expires_at);
    const ttl = expiresAt - Date.now();
    assert.ok(ttl > 4 * 60 * 1000);
    assert.ok(ttl <= 5 * 60 * 1000 + 5_000);

    const redirect = await httpRequest(app).get(body.download_url);
    assert.equal(redirect.status, 302);
    assert.equal(
      redirect.headers.location,
      "https://example.test/files/gap-analysis.pdf",
    );
  });

  it("T02 returns QUEUED without a download url", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-queued-1",
      status: DOCUMENT_REQUEST_STATUSES.queued,
      documentType: DOCUMENT_TYPES.gapAnalysis,
    });

    const response = await getDocumentStatus(app, managerToken, "doc-queued-1");
    const body = successBody<SuccessResponse>(response);

    assert.equal(response.status, 200);
    assert.equal(body.status, DOCUMENT_REQUEST_STATUSES.queued);
    assert.equal(body.download_url, null);
    assert.equal(body.download_url_expires_at, null);
    assert.equal(body.completed_at, null);
  });

  it("T03/T08 returns BLOCKED with business-language reason and no download url", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-blocked-1",
      status: DOCUMENT_REQUEST_STATUSES.blocked,
      documentType: DOCUMENT_TYPES.gapAnalysis,
      blockedReason:
        "Exception at /private/reporting/generator.ts:42 with stack trace",
    });

    const response = await getDocumentStatus(
      app,
      managerToken,
      "doc-blocked-1",
    );
    const body = successBody<SuccessResponse>(response);

    assert.equal(response.status, 200);
    assert.equal(body.status, DOCUMENT_REQUEST_STATUSES.blocked);
    assert.equal(body.download_url, null);
    assert.match(
      body.blocked_reason ?? "",
      /required review items are resolved/i,
    );
    assert.doesNotMatch(JSON.stringify(body), /private|generator\.ts|stack/i);
  });

  it("T06 hides a document outside the caller assessment scope", async () => {
    await prisma.assessment.create({
      data: {
        id: "assessment-other",
        ownerId: "user-2",
        name: "Other assessment",
      },
    });
    await seedDocumentRequest(prisma, {
      id: "doc-other-org-1",
      assessmentId: "assessment-other",
      status: DOCUMENT_REQUEST_STATUSES.queued,
      documentType: DOCUMENT_TYPES.gapAnalysis,
    });

    const response = await getDocumentStatus(
      app,
      managerToken,
      "doc-other-org-1",
    );

    assert.equal(response.status, 404);
    assert.equal(problemCode(response), DOCUMENT_ERROR_CODES.documentNotFound);
  });

  it("T07 hides a FinalReport from a scoped SystemAdmin without access", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-final-report-1",
      status: DOCUMENT_REQUEST_STATUSES.ready,
      documentType: DOCUMENT_TYPES.finalReport,
      documentUrl: "https://example.test/files/final-report.pdf",
    });
    await seedSystemAdmin(prisma);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "system-admin@acme.test",
      password: "SystemAdminPass123!",
      organization_id: "org-1",
    });
    const systemAdminToken = successBody<SignInSuccess>(signIn).session_token;

    const response = await getDocumentStatus(
      app,
      systemAdminToken,
      "doc-final-report-1",
    );

    assert.equal(response.status, 404);
    assert.equal(problemCode(response), DOCUMENT_ERROR_CODES.documentNotFound);
  });

  it("allows a scoped SystemAdmin with redacted read to view GapAnalysis and download it", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-gap-redacted-1",
      status: DOCUMENT_REQUEST_STATUSES.ready,
      documentType: DOCUMENT_TYPES.gapAnalysis,
      documentUrl: "https://example.test/files/redacted-gap.pdf",
    });
    await seedSystemAdmin(prisma);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "system-admin@acme.test",
      password: "SystemAdminPass123!",
      organization_id: "org-1",
    });
    const systemAdminToken = successBody<SignInSuccess>(signIn).session_token;

    const response = await getDocumentStatus(
      app,
      systemAdminToken,
      "doc-gap-redacted-1",
    );
    const body = successBody<SuccessResponse>(response);

    assert.equal(response.status, 200);
    assert.equal(body.document_type, DOCUMENT_TYPES.gapAnalysis);
    assert.ok(body.download_url);
  });
});

function getDocumentStatus(
  app: INestApplication,
  token: string,
  documentRequestId: string,
  assessmentId = "assessment-1",
) {
  return httpRequest(app)
    .get(`/assessments/${assessmentId}/documents/${documentRequestId}`)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Correlation-Id", "doc-status-corr-1");
}

function enableManagerDocumentRead(prisma: PrismaClient) {
  void prisma;
}

async function seedSystemAdmin(prisma: PrismaClient) {
  await prisma.authUser.create({
    data: {
      id: "system-admin-1",
      email: "system-admin@acme.test",
      passwordHash: hashSecret("SystemAdminPass123!"),
      emailVerified: true,
      failedLoginCount: 0,
      role: AUTH_USER_ROLES.admin,
    },
  });
}

async function seedDocumentRequest(
  prisma: PrismaClient,
  input: {
    id: string;
    assessmentId?: string;
    status: DocumentRequestStatus;
    documentType: DocumentType;
    organizationId?: string;
    documentUrl?: string;
    blockedReason?: string;
  },
) {
  const matchId = `lrm-${input.id}`;
  const classificationResultId = `classification-${input.id}`;

  await prisma.legalRuleMatch.create({
    data: {
      id: matchId,
      verifiedProfileId: "vp-1",
      assessmentId: input.assessmentId ?? "assessment-1",
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
      assessmentId: input.assessmentId ?? "assessment-1",
      schemaVersion: "1.0.0",
      classificationData: {
        system_type: "HIGH_IMPACT_AI",
        risk_level: "HIGH",
        citation_basis: ["chunk-1"],
      },
      guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
      blockedReason: null,
      status: CLASSIFICATION_RESULT_STATUSES.accepted,
    },
  });

  await prisma.documentRequest.create({
    data: {
      id: input.id,
      assessmentId: input.assessmentId ?? "assessment-1",
      requestedById: "user-1",
      classificationResultId,
      documentType: toPrismaDocumentType(input.documentType),
      status: toPrismaDocumentRequestStatus(input.status),
      documentUrl: input.documentUrl,
      blockedReason: input.blockedReason,
      correlationId: `${input.id}-corr`,
    },
  });
}
