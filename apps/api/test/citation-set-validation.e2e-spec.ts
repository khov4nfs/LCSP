import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedLegalClassificationParents,
  seedVerifiedProfileGraph,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

const ASSESSMENT_ID = "assessment-citation-validation";
const CORPUS_ID = "corpus-citation-01";
const DOCUMENT_ID = "document-citation-01";
const MATCH_ID = "match-citation-01";

describe("Citation set validation endpoint (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

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
    await prisma.legalRuleMatch.deleteMany();
    await prisma.legalDocumentChunk.deleteMany();
    await prisma.legalSourceDocument.deleteMany();
    await prisma.legalCorpusVersion.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await seedVerifiedProfileGraph(prisma, {
      assessmentId: ASSESSMENT_ID,
      verifiedProfileId: "verified-profile-1",
    });
    await prisma.assessment.update({
      where: { id: ASSESSMENT_ID },
      data: { name: "Citation validation assessment" },
    });
    await seedCorpusAndMatch(prisma);
    adminToken = await signInAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("TC-01/TC-05: validates an allow-listed citation and audits only safe refs", async () => {
    const response = await httpRequest(app)
      .post(`/assessments/${ASSESSMENT_ID}/citation-set-validation`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        corpusVersionId: `corpus_${CORPUS_ID}`,
        legalRuleMatchId: `legal_rule_match_${MATCH_ID}`,
        citationRefs: ["citation:chunk_allowed1"],
      });
    assert.equal(response.status, 200);
    const data = successBody<{
      status: string;
      result: { valid: boolean; items: Array<{ validity: string }> };
    }>(response);
    assert.equal(data.status, "READY");
    assert.equal(data.result.valid, true);
    assert.equal(data.result.items[0]?.validity, "VALID");
    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: "AGENTIC_TOOL_CITATION_SET_VALIDATED" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit);
    assert.equal(
      JSON.stringify(audit.payload).includes("private legal text"),
      false,
    );
  });

  it("TC-03/TC-04: rejects an out-of-allowlist citation", async () => {
    const invalid = await httpRequest(app)
      .post(`/assessments/${ASSESSMENT_ID}/citation-set-validation`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        corpusVersionId: `corpus_${CORPUS_ID}`,
        legalRuleMatchId: `legal_rule_match_${MATCH_ID}`,
        citationRefs: ["citation:chunk_other1"],
      });
    assert.equal(invalid.status, 200);
    assert.equal(
      successBody<{
        result: { valid: boolean; items: Array<{ validity: string }> };
      }>(invalid).result.valid,
      false,
    );
    assert.equal(
      successBody<{ result: { items: Array<{ validity: string }> } }>(invalid)
        .result.items[0]?.validity,
      "OUT_OF_ALLOWLIST",
    );
  });
});

async function seedCorpusAndMatch(prisma: PrismaClient): Promise<void> {
  await seedLegalClassificationParents(prisma, {
    corpusVersionId: CORPUS_ID,
    catalogVersionId: "catalog-1",
  });
  await prisma.legalCorpusVersion.update({
    where: { id: CORPUS_ID },
    data: {
      version: "corpus-citation-v1",
      sourceManifest: {},
    },
  });
  await prisma.legalSourceDocument.create({
    data: {
      id: DOCUMENT_ID,
      legalCorpusVersionId: CORPUS_ID,
      documentId: DOCUMENT_ID,
      title: "Approved legal document",
      sourceUrl: "https://official.example/private",
      sourceSha256:
        "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
      sourceEffectStatus: "CON_HIEU_LUC",
    },
  });
  await prisma.legalDocumentChunk.createMany({
    data: [
      {
        id: "chunk_allowed1",
        legalCorpusVersionId: CORPUS_ID,
        legalSourceDocumentId: DOCUMENT_ID,
        documentId: DOCUMENT_ID,
        locator: "Article 1",
        content: "private legal text",
        contentSha256:
          "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
        hierarchy: {},
        legalStatus: "ACTIVE",
      },
      {
        id: "chunk_other1",
        legalCorpusVersionId: CORPUS_ID,
        legalSourceDocumentId: DOCUMENT_ID,
        documentId: DOCUMENT_ID,
        locator: "Article 2",
        content: "private legal text",
        contentSha256:
          "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
        hierarchy: {},
        legalStatus: "ACTIVE",
      },
    ],
  });
  await prisma.legalRuleMatch.create({
    data: {
      id: MATCH_ID,
      verifiedProfileId: "verified-profile-1",
      assessmentId: ASSESSMENT_ID,
      corpusVersionId: CORPUS_ID,
      legalRuleCatalogVersionId: "catalog-1",
      schemaVersion: "1.0.0",
      matches: {},
      citationAllowlist: ["citation:chunk_allowed1"],
      overallCoverageStatus: "COMPLETE_CITATION",
      guardrailStatus: "PASSED",
      status: "ACCEPTED",
    },
  });
}

async function signInAsAdmin(app: INestApplication): Promise<string> {
  const response = await httpRequest(app).post("/auth/sign-in").send({
    email: "nomembership@acme.test",
    password: "NoMembership123!",
  });
  return String(
    successBody<{ session_token?: string }>(response).session_token ?? "",
  );
}
