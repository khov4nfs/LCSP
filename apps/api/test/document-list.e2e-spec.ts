/** Document List Endpoint (e2e) */

import * as assert from "node:assert/strict";

import {
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
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedLegalClassificationParents,
  seedVerifiedProfileGraph,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

type DocumentListRow = {
  document_request_id: string;
  status: string;
  download_url: string | null;
};

describe("Document List Endpoint (e2e)", () => {
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
      data: { name: "Document list assessment" },
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: "org-1",
    });
    const signInBody = successBody<{ session_token?: string }>(signIn);
    managerToken = signInBody.session_token ?? "";
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("returns list of documents for assessment with statuses and download urls when ready", async () => {
    await seedDocumentRequest(prisma, {
      id: "doc-ready-1",
      status: DOCUMENT_REQUEST_STATUSES.ready,
      documentType: DOCUMENT_TYPES.gapAnalysis,
      documentUrl: "https://example.test/files/gap-analysis.pdf",
    });

    await seedDocumentRequest(prisma, {
      id: "doc-queued-1",
      status: DOCUMENT_REQUEST_STATUSES.queued,
      documentType: DOCUMENT_TYPES.finalReport,
    });

    const res = await httpRequest(app)
      .get(`/assessments/assessment-1/documents`)
      .set("Authorization", `Bearer ${managerToken}`)
      .set("X-Correlation-Id", "list-corr-1");

    assert.equal(res.status, 200);
    const body = successBody<DocumentListRow[]>(res);
    assert.ok(Array.isArray(body));

    const ready = body.find((row) => row.document_request_id === "doc-ready-1");
    assert.ok(ready !== undefined);
    if (!ready) {
      throw new Error("Expected ready document to be present in the list");
    }
    assert.equal(ready.status, DOCUMENT_REQUEST_STATUSES.ready);
    assert.ok(ready.download_url);

    const queued = body.find(
      (row) => row.document_request_id === "doc-queued-1",
    );
    assert.ok(queued !== undefined);
    if (!queued) {
      throw new Error("Expected queued document to be present in the list");
    }
    assert.equal(queued.status, DOCUMENT_REQUEST_STATUSES.queued);
    assert.equal(queued.download_url, null);
  });
});

function enableManagerDocumentRead(prisma: PrismaClient) {
  void prisma;
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
      guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
      blockedReason: null,
      status: CLASSIFICATION_RESULT_STATUSES.accepted,
    },
  });

  await prisma.documentRequest.create({
    data: {
      id: input.id,
      assessmentId: "assessment-1",
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
