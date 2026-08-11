import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { httpRequest, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

import {
  PBAC_ACTIONS,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";

describe("Legal Rule Catalog Endpoints (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let authorToken: string;
  let approverToken: string;
  let restrictedToken: string;
  const orgId = "org-1";

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
    await prisma.ruleApprovalRecord.deleteMany();
    await prisma.legalRule.deleteMany();
    await prisma.legalRuleCatalogVersion.deleteMany();
    await prisma.corpusApprovalRecord.deleteMany();
    await prisma.legalDocumentChunk.deleteMany();
    await prisma.legalSourceDocument.deleteMany();
    await prisma.legalCorpusVersion.deleteMany();

    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    const hashFn = (
      await import("../src/modules/auth-workspace/infrastructure/security/security.utils.js")
    ).hashSecret;
    const passwordHash = hashFn("CorrectHorseBatteryStaple!");

    const authorPolicyId = "policy-author";
    await prisma.authPolicy.create({
      data: {
        id: authorPolicyId,
        version: "2026-07-26-author",
        actions: [
          PBAC_ACTIONS.legalRuleCatalogAuthor,
          PBAC_ACTIONS.legalCorpusIngest,
        ],
        subjectRole: SUBJECT_ROLES.developer,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const authorUserId = "user-author";
    await prisma.authUser.create({
      data: {
        id: authorUserId,
        email: "author@acme.test",
        passwordHash,
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "mem-author",
        userId: authorUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId: authorPolicyId,
        policyVersion: "2026-07-26-author",
      },
    });
    const signInAuthor = await httpRequest(app).post("/auth/sign-in").send({
      email: "author@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    authorToken = String(
      successBody<{ session_token?: string }>(signInAuthor).session_token ?? "",
    );

    const approverPolicyId = "policy-approver";
    await prisma.authPolicy.create({
      data: {
        id: approverPolicyId,
        version: "2026-07-26-approver",
        actions: [
          PBAC_ACTIONS.legalRuleCatalogApprove,
          PBAC_ACTIONS.legalCorpusApprove,
        ],
        subjectRole: SUBJECT_ROLES.developer,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const approverUserId = "user-approver";
    await prisma.authUser.create({
      data: {
        id: approverUserId,
        email: "approver@acme.test",
        passwordHash,
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "mem-approver",
        userId: approverUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId: approverPolicyId,
        policyVersion: "2026-07-26-approver",
      },
    });
    const signInApprover = await httpRequest(app).post("/auth/sign-in").send({
      email: "approver@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    approverToken = String(
      successBody<{ session_token?: string }>(signInApprover).session_token ??
        "",
    );

    const restrictedPolicyId = "policy-restricted";
    await prisma.authPolicy.create({
      data: {
        id: restrictedPolicyId,
        version: "2026-07-26-restricted",
        actions: [PBAC_ACTIONS.workspaceRead],
        subjectRole: SUBJECT_ROLES.developer,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const restrictedUserId = "user-restricted";
    await prisma.authUser.create({
      data: {
        id: restrictedUserId,
        email: "restricted@acme.test",
        passwordHash,
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "mem-restricted",
        userId: restrictedUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId: restrictedPolicyId,
        policyVersion: "2026-07-26-restricted",
      },
    });

    await prisma.legalRuleCatalogVersion.create({
      data: {
        id: "cat-version-1",
        version: "v1.0.0",
        ruleRefs: [],
      },
    });
    await seedApprovedCorpus(prisma);

    const signInRestricted = await httpRequest(app).post("/auth/sign-in").send({
      email: "restricted@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    restrictedToken = String(
      successBody<{ session_token?: string }>(signInRestricted).session_token ??
        "",
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("POST /internal/legal-rule-catalog/rules (Draft)", () => {
    const payload = {
      legalRuleId: "RULE-TEST-001",
      legalRuleCatalogVersionId: "cat-version-1",
      ruleFamily: "SECURITY",
      requiredFacts: {},
      unknownFactPolicy: "BLOCK",
      citationLocatorRefs: [
        {
          legalCorpusVersionId: "corpus-v1",
          documentId: "LAW-TEST",
          locator: "art-1",
        },
      ],
    };

    it("T01: Returns 201 when called by author", async () => {
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/rules")
        .set("Authorization", `Bearer ${authorToken}`)
        .send(payload);

      assert.equal(response.status, 201);
      const body = successBody<{ legalRuleId: string; status: string }>(
        response,
      );
      assert.equal(body.legalRuleId, "RULE-TEST-001");
      assert.equal(body.status, "DRAFT");
    });

    it("T06: Returns 403 when called by restricted user", async () => {
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/rules")
        .set("Authorization", `Bearer ${restrictedToken}`)
        .send(payload);

      assert.equal(response.status, 403);
    });

    it("T06: Returns 403 when called by approver user (missing author right)", async () => {
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/rules")
        .set("Authorization", `Bearer ${approverToken}`)
        .send(payload);

      assert.equal(response.status, 403);
    });
  });

  describe("legal corpus ingest and approval", () => {
    it("stores immutable chunk locators as DRAFT and activates only after matching Legal Operator sign-off", async () => {
      const content = "Điều 1. Test corpus content.";
      const sourceSha = sha256("source");
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-draft-v1",
          sourceManifest: reviewManifest(
            [{ documentId: "LAW-DRAFT", sourceSha256: sourceSha }],
            "user-approver",
          ),
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

      const approval = await httpRequest(app)
        .post(`/internal/legal-rule-catalog/corpus/${draft.id}/approve`)
        .set("Authorization", `Bearer ${approverToken}`)
        .send({ scopeDescription: "Verified source and chunk locator" });
      assert.equal(approval.status, 200);
      assert.equal(
        successBody<{ status: string }>(approval).status,
        LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      );

      const stored = await prisma.legalDocumentChunk.findUnique({
        where: { id: "chunk-draft-v1" },
      });
      assert.equal(stored?.locator, "art-1");
      assert.equal(stored?.contentSha256, sha256(content));

      const approvalRecord = await prisma.corpusApprovalRecord.findFirst({
        where: { legalCorpusVersionId: draft.id },
      });
      assert.equal(approvalRecord?.approvedBy, "user-approver");
    });

    it("fails closed when Legal Operator sign-off is missing", async () => {
      const content = "Điều 1. Unsigned corpus content.";
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
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

    it("fails closed when a document omits its chunk list", async () => {
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-missing-chunks-v1",
          sourceManifest: reviewManifest(
            [
              {
                documentId: "LAW-MISSING-CHUNKS",
                sourceSha256: sha256("missing-chunks-source"),
              },
            ],
            "user-approver",
          ),
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

    it("rejects approval when authenticated approver differs from reviewedBy", async () => {
      const content = "Điều 1. Reviewer mismatch.";
      const sourceSha = sha256("mismatch-source");
      const ingest = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-mismatch-v1",
          sourceManifest: reviewManifest(
            [{ documentId: "LAW-MISMATCH", sourceSha256: sourceSha }],
            "user-author",
          ),
          documents: [
            {
              documentId: "LAW-MISMATCH",
              title: "Reviewer mismatch legal source",
              sourceUrl: "https://example.test/mismatch-law",
              sourceSha256: sourceSha,
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-mismatch-v1",
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
        .post(`/internal/legal-rule-catalog/corpus/${draft.id}/approve`)
        .set("Authorization", `Bearer ${approverToken}`)
        .send({ scopeDescription: "Must not approve for another reviewer" });

      assert.equal(approval.status, 422);
      const stored = await prisma.legalCorpusVersion.findUnique({
        where: { id: draft.id },
      });
      assert.equal(stored?.status, LEGAL_RULE_LIFECYCLE_STATUSES.draft);
    });

    it("fails closed when chunk content hash does not match actual content", async () => {
      const content = "Điều 1. Real content here.";
      const wrongHash = sha256("totally-different-content");
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-hash-mismatch-v1",
          sourceManifest: reviewManifest(
            [
              {
                documentId: "LAW-HASH-MISMATCH",
                sourceSha256: sha256("hash-mismatch-source"),
              },
            ],
            "user-approver",
          ),
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

    it("fails closed when document sourceSha256 does not match signoff", async () => {
      const content = "Điều 1. Source hash mismatch.";
      const response = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-source-hash-mismatch-v1",
          sourceManifest: reviewManifest(
            [
              {
                documentId: "LAW-SOURCE-HASH-MISMATCH",
                sourceSha256: sha256("signed-source-hash"),
              },
            ],
            "user-approver",
          ),
          documents: [
            {
              documentId: "LAW-SOURCE-HASH-MISMATCH",
              title: "Source hash mismatch legal source",
              sourceUrl: "https://example.test/source-hash-mismatch-law",
              sourceSha256: sha256("different-actual-hash"),
              sourceEffectStatus: "ACTIVE",
              chunks: [
                {
                  id: "chunk-source-hash-mismatch-v1",
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

    it("fails closed when version already exists", async () => {
      const content = "Điều 1. Duplicate version test.";
      const sourceSha = sha256("duplicate-source");

      // First ingest succeeds
      const first = await httpRequest(app)
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-duplicate-v1",
          sourceManifest: reviewManifest(
            [{ documentId: "LAW-DUPLICATE", sourceSha256: sourceSha }],
            "user-approver",
          ),
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
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-duplicate-v1",
          sourceManifest: reviewManifest(
            [{ documentId: "LAW-DUPLICATE", sourceSha256: sourceSha }],
            "user-approver",
          ),
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
        .post("/internal/legal-rule-catalog/corpus")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          version: "corpus-already-approved-v1",
          sourceManifest: reviewManifest(
            [{ documentId: "LAW-APPROVED", sourceSha256: sourceSha }],
            "user-approver",
          ),
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

      // First approval succeeds
      const firstApproval = await httpRequest(app)
        .post(`/internal/legal-rule-catalog/corpus/${draft.id}/approve`)
        .set("Authorization", `Bearer ${approverToken}`)
        .send({ scopeDescription: "Initial approval" });
      assert.equal(firstApproval.status, 200);

      // Second approval should fail (already approved)
      const secondApproval = await httpRequest(app)
        .post(`/internal/legal-rule-catalog/corpus/${draft.id}/approve`)
        .set("Authorization", `Bearer ${approverToken}`)
        .send({ scopeDescription: "Duplicate approval attempt" });
      assert.equal(secondApproval.status, 409);
    });
  });

  describe("POST /internal/legal-rule-catalog/versions/:id/approve", () => {
    let versionId: string;

    beforeEach(async () => {
      await httpRequest(app)
        .post("/internal/legal-rule-catalog/rules")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          legalRuleId: "RULE-TEST-002",
          legalRuleCatalogVersionId: "cat-version-1",
          ruleFamily: "RISK",
          requiredFacts: {},
          unknownFactPolicy: "BLOCK",
          citationLocatorRefs: [
            {
              legalCorpusVersionId: "corpus-v1",
              documentId: "LAW-TEST",
              locator: "art-1",
            },
          ],
        });

      versionId = "cat-version-1";
    });

    it("T04: Returns 200 when called by approver", async () => {
      const response = await httpRequest(app)
        .post(`/internal/legal-rule-catalog/versions/${versionId}/approve`)
        .set("Authorization", `Bearer ${approverToken}`)
        .send({
          scopeDescription: "Approved for release",
        });

      assert.equal(response.status, 200);
      assert.equal(
        successBody<{ status: string }>(response).status,
        LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      );
    });

    it("T06: Returns 403 when called by restricted user", async () => {
      const response = await httpRequest(app)
        .post(`/internal/legal-rule-catalog/versions/${versionId}/approve`)
        .set("Authorization", `Bearer ${restrictedToken}`)
        .send({ scopeDescription: "Test" });

      assert.equal(response.status, 403);
    });

    it("T06: Returns 403 when called by author user (missing approve right)", async () => {
      const response = await httpRequest(app)
        .post(`/internal/legal-rule-catalog/versions/${versionId}/approve`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({ scopeDescription: "Test" });

      assert.equal(response.status, 403);
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

function reviewManifest(
  documents: Array<{ documentId: string; sourceSha256: string }>,
  reviewedBy: string,
) {
  return {
    reviewRequired: true,
    normalizationWarnings: [],
    reviewSignoff: {
      state: "APPROVED",
      reviewedBy,
      documents: documents.map((document) => ({
        documentId: document.documentId,
        reviewState: "APPROVED",
        reviewedBy,
        reviewedAt: "2026-08-11T00:00:00+07:00",
        reviewedSourceSha256: document.sourceSha256,
        reviewedTextSha256: sha256(`reviewed:${document.documentId}`),
        hierarchyReviewSha256: sha256(`hierarchy:${document.documentId}`),
      })),
    },
  };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
