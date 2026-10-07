import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { httpRequest, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

import {
  LEGAL_CORPUS_TRUST_POLICIES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";

describe("Legal Rule Catalog Endpoints (e2e)", () => {
  const WORKER_KEY = "worker-api-key-for-legal-corpus-123";
  const SYSTEM_ACTOR = "legal-corpus-activation-service";
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

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.outboxMessage.deleteMany();
    await prisma.legalRetrievalIndex.deleteMany();
    await prisma.ruleApprovalRecord.deleteMany();
    await prisma.legalRule.deleteMany();
    await prisma.legalRuleCatalogVersion.deleteMany();
    await prisma.corpusApprovalRecord.deleteMany();
    await prisma.legalDocumentChunk.deleteMany();
    await prisma.legalSourceDocument.deleteMany();
    await prisma.legalCorpusVersion.deleteMany();

    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    await seedApprovedCorpus(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("legal corpus ingest and approval", () => {
    it("stores immutable chunk locators as DRAFT and activates them through the worker-only validated activation endpoint", async () => {
      const content = "Điều 1. Test corpus content.";
      const sourceSha = sha256("source");
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-draft-v1",
          sourceManifest: autoTrustedManifest(),
          documents: [
            {
              documentId: "LAW-DRAFT",
              title: "Draft legal source",
              sourceUrl: "https://example.test/draft-law",
              sourceSha256: sourceSha,
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-draft-v1",
                  locator: "art-1",
                  content,
                  contentSha256: sha256(content),
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });
      assert.equal(response.status, 201);
      const draft = successBody<{ id: string; status: string }>(response);
      assert.equal(draft.status, LEGAL_RULE_LIFECYCLE_STATUSES.draft);
      await seedValidatedDraftIndex(
        prisma,
        draft.id,
        "retrieval-validation:draft-v1",
      );

      const approval = await httpRequest(app)
        .post(
          `/internal/legal-rule-catalog/corpus/${draft.id}/activate-validated`,
        )
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          integrityManifestRef: "integrity-manifest:draft-v1",
          retrievalValidationRef: "retrieval-validation:draft-v1",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          scopeDescription: "Verified source and chunk locator",
        });
      assert.equal(approval.status, 200);
      const approved = successBody<{
        status: string;
        result: { outboxEventRef: string };
      }>(approval);
      assert.equal(approved.status, LEGAL_RULE_LIFECYCLE_STATUSES.approved);
      assert.match(approved.result.outboxEventRef, /^outbox:/);

      const stored = await prisma.legalDocumentChunk.findUnique({
        where: { id: "chunk-draft-v1" },
      });
      assert.equal(stored?.locator, "art-1");
      assert.equal(stored?.contentSha256, sha256(content));

      const approvalRecord = await prisma.corpusApprovalRecord.findFirst({
        where: { legalCorpusVersionId: draft.id },
      });
      assert.equal(approvalRecord?.approvedBy, SYSTEM_ACTOR);
      assert.equal(
        approvalRecord?.retrievalValidationRef,
        "retrieval-validation:draft-v1",
      );
      const outbox = await prisma.outboxMessage.findMany({
        where: { aggregateId: draft.id },
      });
      assert.equal(outbox.length, 1);
    });

    it("fails closed when the manifest is not official-source auto-trusted", async () => {
      const content = "Điều 1. Unsigned corpus content.";
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-unsigned-v1",
          sourceManifest: { reviewRequired: true },
          documents: [
            {
              documentId: "LAW-UNSIGNED",
              title: "Unsigned legal source",
              sourceUrl: "https://example.test/unsigned-law",
              sourceSha256: sha256("unsigned-source"),
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-unsigned-v1",
                  locator: "art-1",
                  content,
                  contentSha256: sha256(content),
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });

      assert.equal(response.status, 422);
    });

    it("accepts an official-source auto-trusted corpus; no person signs a corpus off", async () => {
      const content = "Điều 1. Auto trusted official corpus content.";
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-official-auto-trusted-v1",
          sourceManifest: {
            reviewRequired: false,
            trustPolicy: LEGAL_CORPUS_TRUST_POLICIES.officialSourceAutoTrusted,
            normalizationWarnings: [],
            sourceArtifacts: [],
          },
          documents: [
            {
              documentId: "LAW-OFFICIAL-AUTO-TRUSTED",
              title: "Official auto trusted legal source",
              sourceUrl: "https://vbpl.vn/test",
              sourceSha256: sha256("official-auto-trusted-source"),
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-official-auto-trusted-v1",
                  locator: "art-1",
                  content,
                  contentSha256: sha256(content),
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });

      assert.equal(response.status, 201);
      const draft = successBody<{ id: string; status: string }>(response);
      assert.equal(draft.status, LEGAL_RULE_LIFECYCLE_STATUSES.draft);
      const stored = await prisma.legalDocumentChunk.findUnique({
        where: { id: "chunk-official-auto-trusted-v1" },
      });
      assert.equal(stored?.contentSha256, sha256(content));
    });

    it("fails closed when a document omits its chunk list", async () => {
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-missing-chunks-v1",
          sourceManifest: autoTrustedManifest(),
          documents: [
            {
              documentId: "LAW-MISSING-CHUNKS",
              title: "Missing chunk list legal source",
              sourceUrl: "https://example.test/missing-chunks-law",
              sourceSha256: sha256("missing-chunks-source"),
              sourceEffectStatus: "ACTIVE",
            },
          ],
        });

      assert.equal(response.status, 422);
    });

    it("fails closed when validated activation is called without the worker api key", async () => {
      const draft = await seedDraftCorpus(prisma, {
        version: "corpus-missing-worker-key-v1",
        documentId: "LAW-WORKER-KEY",
        chunkId: "chunk-worker-key-v1",
      });
      await seedValidatedDraftIndex(
        prisma,
        draft.id,
        "retrieval-validation:worker-key-v1",
      );

      const approval = await httpRequest(app)
        .post(
          `/internal/legal-rule-catalog/corpus/${draft.id}/activate-validated`,
        )
        .send({
          integrityManifestRef: "integrity-manifest:worker-key-v1",
          retrievalValidationRef: "retrieval-validation:worker-key-v1",
          idempotencyKey: "22222222-2222-4222-8222-222222222222",
          scopeDescription: "Should require worker auth",
        });

      assert.equal(approval.status, 401);
      const stored = await prisma.legalCorpusVersion.findUnique({
        where: { id: draft.id },
      });
      assert.equal(stored?.status, LEGAL_RULE_LIFECYCLE_STATUSES.draft);
    });

    it("fails closed when chunk content hash does not match actual content", async () => {
      const content = "Điều 1. Real content here.";
      const wrongHash = sha256("totally-different-content");
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-hash-mismatch-v1",
          sourceManifest: autoTrustedManifest(),
          documents: [
            {
              documentId: "LAW-HASH-MISMATCH",
              title: "Hash mismatch legal source",
              sourceUrl: "https://example.test/hash-mismatch-law",
              sourceSha256: sha256("hash-mismatch-source"),
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-hash-mismatch-v1",
                  locator: "art-1",
                  content,
                  contentSha256: wrongHash,
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });

      assert.equal(response.status, 422);
      const corpus = await prisma.legalCorpusVersion.findUnique({
        where: { version: "corpus-hash-mismatch-v1" },
      });
      assert.equal(corpus, null);
    });

    it("fails closed when version already exists", async () => {
      const content = "Điều 1. Duplicate version test.";
      const sourceSha = sha256("duplicate-source");

      // First ingest succeeds
      const first = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-duplicate-v1",
          sourceManifest: autoTrustedManifest(),
          documents: [
            {
              documentId: "LAW-DUPLICATE",
              title: "Duplicate version legal source",
              sourceUrl: "https://example.test/duplicate-law",
              sourceSha256: sourceSha,
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-duplicate-v1",
                  locator: "art-1",
                  content,
                  contentSha256: sha256(content),
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });
      assert.equal(first.status, 201);

      // Second ingest with same version should fail
      const second = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-duplicate-v1",
          sourceManifest: autoTrustedManifest(),
          documents: [
            {
              documentId: "LAW-DUPLICATE",
              title: "Duplicate version legal source",
              sourceUrl: "https://example.test/duplicate-law",
              sourceSha256: sourceSha,
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-duplicate-v1-attempt2",
                  locator: "art-1",
                  content,
                  contentSha256: sha256(content),
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });
      assert.equal(second.status, 409);
    });

    it("prevents approval when corpus is not in DRAFT status", async () => {
      const content = "Điều 1. Already approved corpus.";
      const sourceSha = sha256("approved-source");

      // Create and approve corpus
      const ingest = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-already-approved-v1",
          sourceManifest: autoTrustedManifest(),
          documents: [
            {
              documentId: "LAW-APPROVED",
              title: "Already approved legal source",
              sourceUrl: "https://example.test/approved-law",
              sourceSha256: sourceSha,
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-approved-v1",
                  locator: "art-1",
                  content,
                  contentSha256: sha256(content),
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });
      assert.equal(ingest.status, 201);
      const draft = successBody<{ id: string }>(ingest);
      await seedValidatedDraftIndex(
        prisma,
        draft.id,
        "retrieval-validation:approved-v1",
      );

      // First approval succeeds
      const firstApproval = await httpRequest(app)
        .post(
          `/internal/legal-rule-catalog/corpus/${draft.id}/activate-validated`,
        )
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          integrityManifestRef: "integrity-manifest:approved-v1",
          retrievalValidationRef: "retrieval-validation:approved-v1",
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
          scopeDescription: "Initial approval",
        });
      assert.equal(firstApproval.status, 200);

      // Same idempotency key replays prior terminal result
      const secondApproval = await httpRequest(app)
        .post(
          `/internal/legal-rule-catalog/corpus/${draft.id}/activate-validated`,
        )
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          integrityManifestRef: "integrity-manifest:approved-v1",
          retrievalValidationRef: "retrieval-validation:approved-v1",
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
          scopeDescription: "Duplicate approval attempt",
        });
      assert.equal(secondApproval.status, 200);

      const conflictingApproval = await httpRequest(app)
        .post(
          `/internal/legal-rule-catalog/corpus/${draft.id}/activate-validated`,
        )
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          integrityManifestRef: "integrity-manifest:approved-v1",
          retrievalValidationRef: "retrieval-validation:approved-v1",
          idempotencyKey: "44444444-4444-4444-8444-444444444444",
          scopeDescription: "Conflicting replay",
        });
      assert.equal(conflictingApproval.status, 409);
    });

    it("blocks activation when the draft corpus has no validated retrieval index", async () => {
      const content = "Điều 1. Missing retrieval validation.";
      const sourceSha = sha256("blocked-source");
      const ingest = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus/validated-draft")
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          version: "corpus-blocked-v1",
          sourceManifest: autoTrustedManifest(),
          documents: [
            {
              documentId: "LAW-BLOCKED",
              title: "Blocked legal source",
              sourceUrl: "https://example.test/blocked-law",
              sourceSha256: sourceSha,
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-blocked-v1",
                  locator: "art-1",
                  content,
                  contentSha256: sha256(content),
                  hierarchy: { article: "1" },
                  legalStatus: "ACTIVE",
                },
              ],
            },
          ],
        });
      assert.equal(ingest.status, 201);
      const draft = successBody<{ id: string }>(ingest);

      const approval = await httpRequest(app)
        .post(
          `/internal/legal-rule-catalog/corpus/${draft.id}/activate-validated`,
        )
        .set("x-worker-api-key", WORKER_KEY)
        .send({
          integrityManifestRef: "integrity-manifest:blocked-v1",
          retrievalValidationRef: "retrieval-validation:missing-v1",
          idempotencyKey: "55555555-5555-4555-8555-555555555555",
          scopeDescription: "Should block without validated index",
        });
      assert.equal(approval.status, 422);
      const stored = await prisma.legalCorpusVersion.findUnique({
        where: { id: draft.id },
      });
      assert.equal(stored?.status, LEGAL_RULE_LIFECYCLE_STATUSES.draft);
    });
  });
});

async function seedApprovedCorpus(prisma: PrismaClient): Promise<void> {
  const corpus = await prisma.legalCorpusVersion.create({
    data: {
      id: "corpus-v1",
      version: "corpus-v1",
      status: "APPROVED",
      sourceManifest: {},
      approvedAt: new Date(),
    },
  });
  const document = await prisma.legalSourceDocument.create({
    data: {
      legalCorpusVersionId: corpus.id,
      documentId: "LAW-TEST",
      title: "Test law",
      sourceUrl: "https://example.test/law",
      sourceSha256: "sha256:test",
      sourceEffectStatus: "ACTIVE",
    },
  });
  await prisma.legalDocumentChunk.create({
    data: {
      id: "chunk-test-1",
      legalCorpusVersionId: corpus.id,
      legalSourceDocumentId: document.id,
      documentId: document.documentId,
      locator: "art-1",
      content: "Test legal source content.",
      contentSha256: "sha256:test",
      hierarchy: { article: "1" },
      legalStatus: "ACTIVE",
    },
  });
}

async function seedValidatedDraftIndex(
  prisma: PrismaClient,
  corpusVersionId: string,
  validationManifestRef: string,
): Promise<void> {
  await prisma.legalRetrievalIndex.create({
    data: {
      id: `idx-${corpusVersionId}`,
      legalCorpusVersionId: corpusVersionId,
      version: `index-${corpusVersionId}`,
      status: "VALID",
      configHash: sha256(`config:${corpusVersionId}`),
      contentHash: sha256(`content:${corpusVersionId}`),
      validationManifestRef,
      validatedAt: new Date("2026-08-12T00:00:00.000Z"),
    },
  });
}

async function seedDraftCorpus(
  prisma: PrismaClient,
  input: {
    version: string;
    documentId: string;
    chunkId: string;
  },
): Promise<{ id: string }> {
  const sourceSha = sha256(`source:${input.version}`);
  const content = `Điều 1. Draft content for ${input.version}.`;
  const corpus = await prisma.legalCorpusVersion.create({
    data: {
      version: input.version,
      status: "DRAFT",
      sourceManifest: { automatedValidationCandidate: true },
    },
  });
  const document = await prisma.legalSourceDocument.create({
    data: {
      legalCorpusVersionId: corpus.id,
      documentId: input.documentId,
      title: `Seeded ${input.documentId}`,
      sourceUrl: "https://example.test/seeded-law",
      sourceSha256: sourceSha,
      sourceEffectStatus: "ACTIVE",
    },
  });
  await prisma.legalDocumentChunk.create({
    data: {
      id: input.chunkId,
      legalCorpusVersionId: corpus.id,
      legalSourceDocumentId: document.id,
      documentId: input.documentId,
      locator: "art-1",
      content,
      contentSha256: sha256(content),
      hierarchy: { article: "1" },
      legalStatus: "ACTIVE",
    },
  });
  return { id: corpus.id };
}

function autoTrustedManifest() {
  return {
    reviewRequired: false,
    trustPolicy: LEGAL_CORPUS_TRUST_POLICIES.officialSourceAutoTrusted,
    normalizationWarnings: [],
    sourceArtifacts: [],
  };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
