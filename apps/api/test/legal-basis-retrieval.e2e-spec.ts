import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { LegalRetrievalIndexStatus, PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

const ORGANIZATION_ID = "org-1";
const ASSESSMENT_ID = "assessment-legal-basis";
const CORPUS_ID = "corpus-basis-01";
const INDEX_ID = "index-basis-01";
const DOCUMENT_ID = "document-basis-01";

describe("Legal basis retrieval endpoint (e2e)", () => {
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
    await prisma.legalRetrievalIndex.deleteMany();
    await prisma.corpusApprovalRecord.deleteMany();
    await prisma.legalDocumentChunk.deleteMany();
    await prisma.legalSourceDocument.deleteMany();
    await prisma.legalCorpusVersion.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.assessment.create({
      data: {
        id: ASSESSMENT_ID,
        ownerId: "user-1",
        name: "Legal basis assessment",
      },
    });
    await seedReadyCorpus(prisma);
    managerToken = await signIn(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("TC-01/TC-05: returns bounded primary, parent, and reference citations with safe audit metadata", async () => {
    const response = await httpRequest(app)
      .post(`/assessments/${ASSESSMENT_ID}/legal-basis`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        corpusVersionId: `corpus_${CORPUS_ID}`,
        selectors: { chunkIds: ["chunk_primary1"] },
        includeContext: true,
      });

    assert.equal(response.status, 200);
    const data = successBody<{
      status: string;
      evidenceRefs: string[];
      result: {
        outcome: string;
        citations: Array<{
          chunkId: string;
          contextRole: string;
          excerpt: string;
        }>;
      };
    }>(response);
    assert.equal(data.status, "READY");
    assert.equal(data.result.outcome, "MATCHED");
    assert.deepEqual(
      data.result.citations.map(({ contextRole }) => contextRole),
      ["PRIMARY_MATCH", "PARENT_CONTEXT", "REFERENCED_CONTEXT"],
    );
    assert.ok(data.result.citations[0]?.excerpt.includes("approved clause"));
    assert.equal(
      JSON.stringify(response.body).includes("must never leak"),
      false,
    );
    assert.equal(
      JSON.stringify(response.body).includes("official.example"),
      false,
    );

    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: "AGENTIC_TOOL_LEGAL_BASIS_RETRIEVED" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit);
    assert.equal(
      JSON.stringify(audit.payload).includes("approved clause"),
      false,
    );
    assert.equal(
      JSON.stringify(audit.payload).includes("must never leak"),
      false,
    );
  });

  it("TC-03: returns an explicit coverage limitation rather than a substitute for a repealed selector", async () => {
    await prisma.legalDocumentChunk.update({
      where: { id: "chunk_primary1" },
      data: { legalStatus: "REPEALED" },
    });

    const response = await httpRequest(app)
      .post(`/assessments/${ASSESSMENT_ID}/legal-basis`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        corpusVersionId: `corpus_${CORPUS_ID}`,
        selectors: { chunkIds: ["chunk_primary1"] },
        includeContext: false,
      });

    assert.equal(response.status, 200);
    const data = successBody<{
      status: string;
      limitations: Array<{ code: string }>;
      result: { citations: unknown[] };
    }>(response);
    assert.equal(data.status, "OUT_OF_COVERAGE");
    assert.equal(data.limitations[0]?.code, "NO_EFFECTIVE_CHUNK_FOR_SELECTOR");
    assert.deepEqual(data.result.citations, []);
  });
});

async function seedReadyCorpus(prisma: PrismaClient): Promise<void> {
  await prisma.legalCorpusVersion.create({
    data: {
      id: CORPUS_ID,
      version: "corpus-basis-v1",
      status: "APPROVED",
      sourceManifest: {
        sourceUrl: "https://official.example/private",
        rawSourceText: "must never leak",
      },
      approvedAt: new Date("2026-01-01T00:00:00.000Z"),
      retrievalIndexes: {
        create: {
          id: INDEX_ID,
          version: "index-basis-v1",
          status: LegalRetrievalIndexStatus.VALID,
          configHash:
            "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
          contentHash:
            "sha256:6ff279fb6419f64bc17f02eec2296a4e3de1a9d61eaad77ef19b8235c3948232",
          validationManifestRef: "retrieval-validation:index-basis-v1",
          validatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    },
  });
  await prisma.legalSourceDocument.create({
    data: {
      id: DOCUMENT_ID,
      legalCorpusVersionId: CORPUS_ID,
      documentId: DOCUMENT_ID,
      title: "Approved legal document",
      sourceUrl: "https://official.example/private-document",
      sourceSha256:
        "sha256:6ff279fb6419f64bc17f02eec2296a4e3de1a9d61eaad77ef19b8235c3948232",
      sourceEffectStatus: "CON_HIEU_LUC",
    },
  });
  await prisma.legalDocumentChunk.createMany({
    data: [
      {
        id: "chunk_primary1",
        legalCorpusVersionId: CORPUS_ID,
        legalSourceDocumentId: DOCUMENT_ID,
        documentId: DOCUMENT_ID,
        locator: "Article 12(1)",
        content: "The approved clause is safe to cite.",
        contentSha256:
          "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
        hierarchy: {
          parentChunkId: "chunk_parent1",
          outgoingRefIds: ["chunk_related1"],
        },
        legalStatus: "ACTIVE",
      },
      {
        id: "chunk_parent1",
        legalCorpusVersionId: CORPUS_ID,
        legalSourceDocumentId: DOCUMENT_ID,
        documentId: DOCUMENT_ID,
        locator: "Article 12",
        content: "The approved parent context is safe to cite.",
        contentSha256:
          "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
        hierarchy: {},
        legalStatus: "ACTIVE",
      },
      {
        id: "chunk_related1",
        legalCorpusVersionId: CORPUS_ID,
        legalSourceDocumentId: DOCUMENT_ID,
        documentId: DOCUMENT_ID,
        locator: "Article 19",
        content: "The approved referenced context is safe to cite.",
        contentSha256:
          "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
        hierarchy: {},
        legalStatus: "ACTIVE",
      },
    ],
  });
}

async function signIn(app: INestApplication): Promise<string> {
  const response = await httpRequest(app).post("/auth/sign-in").send({
    email: "nomembership@acme.test",
    password: "NoMembership123!",
    organization_id: ORGANIZATION_ID,
  });
  return String(
    successBody<{ session_token?: string }>(response).session_token ?? "",
  );
}
