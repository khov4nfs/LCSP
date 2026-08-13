/** MW-doc-003: Document Status and Download Endpoint (e2e). */

import * as assert from "node:assert/strict";

import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
  type DocumentRequestStatus,
  type DocumentType,
} from "@lcsp/contracts/document";
import {
  PBAC_ACTIONS,
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
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
    await enableManagerDocumentRead(prisma);

    await prisma.assessment.create({
      data: {
        id: "assessment-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Document status assessment",
      },
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

  it("T05 denies an actor without document:read", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-denied-1",
      status: DOCUMENT_REQUEST_STATUSES.queued,
      documentType: DOCUMENT_TYPES.gapAnalysis,
    });
    await prisma.authPolicy.update({
      where: {
        id_version: {
          id: "policy-manager-workspace",
          version: "2026-06-26",
        },
      },
      data: { actions: [PBAC_ACTIONS.workspaceRead] },
    });

    const response = await getDocumentStatus(app, managerToken, "doc-denied-1");

    assert.equal(response.status, 403);
    assert.equal(problemCode(response), PBAC_REASON_CODE.denied);
  });

  it("T06 hides a document outside the session organization", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-other-org-1",
      status: DOCUMENT_REQUEST_STATUSES.queued,
      documentType: DOCUMENT_TYPES.gapAnalysis,
      organizationId: "org-other",
    });

    const response = await getDocumentStatus(
      app,
      managerToken,
      "doc-other-org-1",
    );

    assert.equal(response.status, 404);
    assert.equal(problemCode(response), DOCUMENT_ERROR_CODES.documentNotFound);
  });

  it("T07 denies a Developer with redacted read when accessing FinalReport", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-final-report-1",
      status: DOCUMENT_REQUEST_STATUSES.ready,
      documentType: DOCUMENT_TYPES.finalReport,
      documentUrl: "https://example.test/files/final-report.pdf",
    });
    await seedDeveloper(prisma, PBAC_ACTIONS.documentReadRedacted);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "developer@acme.test",
      password: "DeveloperPass123!",
      organization_id: "org-1",
    });
    const developerToken = successBody<SignInSuccess>(signIn).session_token;

    const response = await getDocumentStatus(
      app,
      developerToken,
      "doc-final-report-1",
    );

    assert.equal(response.status, 403);
    assert.equal(problemCode(response), PBAC_REASON_CODE.denied);
  });

  it("allows a scoped Developer with redacted read to view GapAnalysis and download it", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-gap-redacted-1",
      status: DOCUMENT_REQUEST_STATUSES.ready,
      documentType: DOCUMENT_TYPES.gapAnalysis,
      documentUrl: "https://example.test/files/redacted-gap.pdf",
    });
    await seedDeveloper(prisma, PBAC_ACTIONS.documentReadRedacted);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "developer@acme.test",
      password: "DeveloperPass123!",
      organization_id: "org-1",
    });
    const developerToken = successBody<SignInSuccess>(signIn).session_token;

    const response = await getDocumentStatus(
      app,
      developerToken,
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
) {
  return httpRequest(app)
    .get(`/assessments/assessment-1/documents/${documentRequestId}`)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Correlation-Id", "doc-status-corr-1");
}

async function enableManagerDocumentRead(prisma: PrismaClient) {
  await prisma.authPolicy.update({
    where: {
      id_version: {
        id: "policy-manager-workspace",
        version: "2026-06-26",
      },
    },
    data: {
      actions: [
        PBAC_ACTIONS.workspaceRead,
        PBAC_ACTIONS.documentGenerate,
        PBAC_ACTIONS.documentRead,
      ],
    },
  });
}

async function seedDeveloper(prisma: PrismaClient, action: string) {
  await prisma.authUser.create({
    data: {
      id: "developer-1",
      email: "developer@acme.test",
      passwordHash: hashSecret("DeveloperPass123!"),
      emailVerified: true,
      failedLoginCount: 0,
    },
  });

  await prisma.authPolicy.create({
    data: {
      id: `policy-developer-${action.replace(/[^a-z]/gi, "-")}`,
      version: "2026-07-28",
      actions: [action],
      subjectRole: SUBJECT_ROLES.developer,
      stateGate: PBAC_STATE_GATES.membershipActive,
      organizationId: "org-1",
    },
  });

  await prisma.authMembership.create({
    data: {
      id: "membership-developer-document-read",
      userId: "developer-1",
      organizationId: "org-1",
      status: AUTH_MEMBERSHIP_STATUSES.active,
      subjectAttributes: {
        role: SUBJECT_ROLES.developer,
        scope: "assessment-1",
      },
      policyId: `policy-developer-${action.replace(/[^a-z]/gi, "-")}`,
      policyVersion: "2026-07-28",
    },
  });
}

async function seedDocumentRequest(
  prisma: PrismaClient,
  input: {
    id: string;
    status: DocumentRequestStatus;
    documentType: DocumentType;
    organizationId?: string;
    documentUrl?: string;
    blockedReason?: string;
  },
) {
  const matchId = `lrm-${input.id}`;
  const classificationResultId = `classification-${input.id}`;
  const organizationId = input.organizationId ?? "org-1";

  await prisma.legalRuleMatch.create({
    data: {
      id: matchId,
      verifiedProfileId: "vp-1",
      assessmentId: "assessment-1",
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
      status: CLASSIFICATION_RESULT_STATUSES.accepted,
    },
  });

  await prisma.classificationResult.create({
    data: {
      id: classificationResultId,
      legalRuleMatchId: matchId,
      verifiedProfileId: "vp-1",
      assessmentId: "assessment-1",
      organizationId,
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
      assessmentId: "assessment-1",
      organizationId,
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
