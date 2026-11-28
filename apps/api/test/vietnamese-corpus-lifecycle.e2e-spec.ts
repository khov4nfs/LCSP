import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
} from "@lcsp/contracts/compliance-rule-set";
import * as C from "@lcsp/contracts/legal-rule-catalog";
import {
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
  LEGAL_SOURCE_TRUST_POLICIES,
} from "@lcsp/contracts/legal-source";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LegalEffectStatus,
  LegalRetrievalIndexStatus,
  LegalSourceDocumentCorpusRole,
  PreparationScopeReviewState,
  PreparationTargetActivityScope,
  PrismaClient,
} from "@prisma/client";
import * as assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "reflect-metadata";
import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import { OFFICIAL_LEGAL_CORPUS } from "../src/modules/legal-source/domain/official-legal-authority.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

describe("Official Vietnamese Corpus End-to-End Lifecycle (e2e) [LCSP-424]", () => {
  const WORKER_KEY = "worker-api-key-for-vn-corpus-e2e";
  const originalWorkerApiKey = process.env.WORKER_API_KEY;
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_KEY;
    pushPrismaSchema();

    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    // Use production AppModule WITHOUT overriding LegalSourceAuthorityService.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (originalWorkerApiKey === undefined) {
      delete process.env.WORKER_API_KEY;
    } else {
      process.env.WORKER_API_KEY = originalWorkerApiKey;
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it("admits official Vietnamese PDF, reviews scope, imports model-free rules, activates DEVELOPMENT_ONLY set, and admits Assessment", async () => {
    await prisma.assessment.deleteMany();
    await prisma.complianceRuleSetVersion.deleteMany();
    await prisma.legalRuleCatalogVersion.deleteMany();
    await prisma.selectedRuleScopeAuthorization.deleteMany();
    await prisma.legalSourceVersion.deleteMany();
    await prisma.legalSourceDocumentBlob.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    // Seed two distinct Admin users (author = user-3, independent reviewer = admin-reviewer-vn-e2e).
    const seededAdmin = await prisma.user.findUniqueOrThrow({
      where: { id: "user-3" },
      select: { passwordHash: true },
    });
    await prisma.user.create({
      data: {
        id: "admin-reviewer-vn-e2e",
        email: "reviewer-vn@acme.test",
        displayName: "VN Reviewer Admin",
        passwordHash: seededAdmin.passwordHash,
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.admin,
      },
    });
    const authorSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "nomembership@acme.test",
      password: "NoMembership123!",
    });
    const reviewerSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "reviewer-vn@acme.test",
      password: "NoMembership123!",
    });
    const authorToken =
      successBody<SignInSuccess>(authorSignIn)?.session_token ?? "";
    const reviewerToken =
      successBody<SignInSuccess>(reviewerSignIn)?.session_token ?? "";
    assert.ok(authorToken && reviewerToken, "admin sign-ins must succeed");

    // 1. Official Vietnamese PDF admission (Thông tư 05/2026/TT-BKHCN from tracked corpus).
    const officialDoc = OFFICIAL_LEGAL_CORPUS.find(
      (entry) => entry.number === "05-2026-TT-BKHCN",
    );
    assert.ok(
      officialDoc,
      "05-2026-TT-BKHCN must exist in OFFICIAL_LEGAL_CORPUS",
    );

    const pdfPath = resolve(
      process.cwd(),
      "../../deepagents/evals/corpora/lcsp-402-vn-cong-bao-v1/05-05-2026-TT-BKHCN.pdf",
    );
    const pdfBytes = readFileSync(pdfPath);
    const pdfDigest = sha256(pdfBytes);
    assert.equal(pdfDigest, officialDoc.sha256);

    await prisma.legalSourceDocumentBlob.create({
      data: {
        sha256: pdfDigest,
        byteLength: pdfBytes.byteLength,
        bytes: pdfBytes,
      },
    });

    const inScopeChunkText =
      "Điều 4. Tổ chức phát triển hệ thống AI phải lưu giữ nhật ký huấn luyện và kiểm thử mô hình tối thiểu 12 tháng.";
    const outOfScopeChunkText =
      "Điều 9. Cơ quan quản lý nhà nước tổ chức thanh tra định kỳ hằng năm đối với hoạt động cung cấp dịch vụ.";
    const inScopeChunkId = "vn-chunk-art-4";
    const outOfScopeChunkId = "vn-chunk-art-9";

    const draftRes = await httpRequest(app)
      .post("/internal/legal-sources/validated-draft")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        version: `vn-tt-05-2026-${randomUUID().slice(0, 8)}`,
        sourceManifest: {
          reviewRequired: false,
          trustPolicy: LEGAL_SOURCE_TRUST_POLICIES.officialSourceAutoTrusted,
          normalizationWarnings: [],
          sourceArtifacts: [],
        },
        documents: [
          {
            documentId: "05-2026-TT-BKHCN",
            title: "Thông tư 05/2026/TT-BKHCN",
            sourceUrl: officialDoc.downloadUrl,
            sourceSha256: `sha256:${pdfDigest}`,
            sourceEffectStatus: "ACTIVE",
            chunks: [
              {
                id: inScopeChunkId,
                locator: "Điều 4",
                content: inScopeChunkText,
                contentSha256: `sha256:${sha256(inScopeChunkText)}`,
                hierarchy: { article: "4" },
                legalStatus: "ACTIVE",
              },
              {
                id: outOfScopeChunkId,
                locator: "Điều 9",
                content: outOfScopeChunkText,
                contentSha256: `sha256:${sha256(outOfScopeChunkText)}`,
                hierarchy: { article: "9" },
                legalStatus: "ACTIVE",
              },
            ],
          },
        ],
      });
    assert.equal(draftRes.status, 201, JSON.stringify(draftRes.body));
    const draftSource = successBody<{ id: string; status: string }>(draftRes);
    assert.equal(draftSource.status, LEGAL_SOURCE_LIFECYCLE_STATUSES.draft);

    // Bind the server-owned original blob and retrieval index to the draft version.
    await prisma.legalSourceDocument.updateMany({
      where: { legalSourceVersionId: draftSource.id },
      data: {
        blobSha256: pdfDigest,
        corpusRole: LegalSourceDocumentCorpusRole.OPERATIVE,
      },
    });
    await prisma.legalDocumentChunk.updateMany({
      where: { legalSourceVersionId: draftSource.id },
      data: {
        legalEffectStatus: LegalEffectStatus.EFFECTIVE,
        legalStatusSourceRef: officialDoc.sourcePage,
      },
    });
    await prisma.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId: draftSource.id,
        version: `vn-05-2026-idx-${randomUUID().slice(0, 8)}`,
        configHash: sha256("vn-05-2026-config"),
        status: LegalRetrievalIndexStatus.VALID,
        contentHash: sha256(`${inScopeChunkText}\n${outOfScopeChunkText}`),
        validationManifestRef: "retrieval-validation:vn-05-2026",
        validatedAt: new Date(),
      },
    });

    const activateSourceRes = await httpRequest(app)
      .post(`/internal/legal-sources/${draftSource.id}/activate-validated`)
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        integrityManifestRef: "integrity-manifest:vn-05-2026",
        retrievalValidationRef: "retrieval-validation:vn-05-2026",
        idempotencyKey: randomUUID(),
        scopeDescription: "Official Vietnamese TT 05/2026/TT-BKHCN",
      });
    assert.equal(activateSourceRes.status, 200);

    // 2. Catalog authoring + Semantic Review (Submit as author, Approve as independent reviewer).
    const catalogRes = await httpRequest(app)
      .post("/admin/legal-rule-catalog")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        version: `vn-ai-catalog-${randomUUID().slice(0, 8)}`,
        legalSourceVersionId: draftSource.id,
      });
    assert.equal(catalogRes.status, 201, JSON.stringify(catalogRes.body));
    const catalog = successBody<{ id: string; revision: number }>(catalogRes);

    const saveInScopeRes = await httpRequest(app)
      .post(`/admin/legal-rule-catalog/${catalog.id}/rules`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        legalRuleId: "VN-TT05-ART4-LOG-RETENTION",
        expectedRevision: catalog.revision,
        title: "Lưu giữ nhật ký huấn luyện và kiểm thử mô hình",
        description:
          "Tổ chức phát triển hệ thống AI phải lưu giữ nhật ký huấn luyện và kiểm thử mô hình tối thiểu 12 tháng.",
        citationLocatorRefs: [
          {
            documentId: "05-2026-TT-BKHCN",
            locator: "Điều 4",
          },
        ],
      });
    assert.equal(
      saveInScopeRes.status,
      200,
      JSON.stringify(saveInScopeRes.body),
    );
    const inScopeSaved = successBody<{
      rule: { id: string };
      catalogRevision: number;
    }>(saveInScopeRes);

    const saveOutOfScopeRes = await httpRequest(app)
      .post(`/admin/legal-rule-catalog/${catalog.id}/rules`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        legalRuleId: "VN-TT05-ART9-REGULATOR-INSPECTION",
        expectedRevision: inScopeSaved.catalogRevision,
        title: "Thanh tra định kỳ của cơ quan nhà nước",
        description:
          "Cơ quan quản lý nhà nước tổ chức thanh tra định kỳ hằng năm đối với hoạt động cung cấp dịch vụ.",
        citationLocatorRefs: [
          {
            documentId: "05-2026-TT-BKHCN",
            locator: "Điều 9",
          },
        ],
      });
    assert.equal(
      saveOutOfScopeRes.status,
      200,
      JSON.stringify(saveOutOfScopeRes.body),
    );
    const outOfScopeSaved = successBody<{
      rule: { id: string };
      catalogRevision: number;
    }>(saveOutOfScopeRes);

    const inScopeRuleId = inScopeSaved.rule.id;
    const outOfScopeRuleId = outOfScopeSaved.rule.id;

    const inScopeRef = {
      documentId: "05-2026-TT-BKHCN",
      locator: "Điều 4",
      contentSha256: `sha256:${sha256(inScopeChunkText)}`,
    };
    const outOfScopeRef = {
      documentId: "05-2026-TT-BKHCN",
      locator: "Điều 9",
      contentSha256: `sha256:${sha256(outOfScopeChunkText)}`,
    };

    const inScopeImportItem: C.AssessmentRuleImportItem = {
      ruleId: inScopeRuleId,
      legalRequirements: [
        {
          legalRequirementId: `${inScopeRuleId}:req-1`,
          title: "Lưu giữ nhật ký huấn luyện tối thiểu 12 tháng",
          proposition:
            "Tổ chức phát triển hệ thống AI phải lưu giữ nhật ký huấn luyện và kiểm thử mô hình tối thiểu 12 tháng.",
          operativePropositions: [
            {
              actor: "Tổ chức phát triển hệ thống AI",
              modality: LEGAL_OPERATIVE_MODALITIES.DUTY,
              action:
                "Lưu giữ nhật ký huấn luyện và kiểm thử mô hình tối thiểu 12 tháng",
              sourceRefs: [inScopeRef],
            },
          ],
          applicabilityConditions: [
            "Hệ thống AI được phát triển và đưa vào kiểm thử",
          ],
          qualifiers: [],
          exceptions: [],
          nonRepositoryDuty: false,
          coverage: {
            state:
              LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
            nonAssessableReason: null,
          },
          sourceRefs: [inScopeRef],
        },
      ],
      contextRelations: [],
      assessmentRules: [
        {
          assessmentRuleId: `${inScopeRuleId}:ar-1`,
          concept: "Kiểm tra cơ chế lưu giữ nhật ký huấn luyện và kiểm thử",
          legalRequirementIds: [`${inScopeRuleId}:req-1`],
          criteria: [
            {
              criterionId: "crit-1",
              legalRequirementIds: [`${inScopeRuleId}:req-1`],
            },
          ],
          evidenceBindings: [{ criterionId: "crit-1", kind: "REQUIRED" }],
          requiredEvidence: [
            "Cấu hình lưu trữ nhật ký huấn luyện tối thiểu 12 tháng",
          ],
          sourceRefs: [inScopeRef],
        },
      ],
    };

    const inScopeOutput = C.preparationRuleOutputSchema.parse({
      analysis: C.ASSESSMENT_RULE_IMPORT_DEFAULT_ANALYSIS,
      legalRequirements: inScopeImportItem.legalRequirements,
      contextRelations: [],
      assessmentRules: inScopeImportItem.assessmentRules.map((rule) => ({
        investigationGoals: [],
        startingNodeTypes: [],
        targetNodeTypes: [],
        edgeStrategies: [],
        graphQueries: [],
        keywords: [],
        commonApis: [],
        commonLibraries: [],
        patterns: [],
        supportingEvidence: [],
        negativeEvidence: [],
        ...rule,
      })),
    });

    const outOfScopeOutput = C.preparationRuleOutputSchema.parse({
      analysis: "Điều 9 là hoạt động thanh tra của cơ quan nhà nước.",
      legalRequirements: [
        {
          legalRequirementId: `${outOfScopeRuleId}:req-1`,
          title: "Cơ quan quản lý nhà nước tổ chức thanh tra định kỳ",
          proposition:
            "Cơ quan quản lý nhà nước tổ chức thanh tra định kỳ hằng năm đối với hoạt động cung cấp dịch vụ.",
          operativePropositions: [
            {
              actor: "Cơ quan quản lý nhà nước",
              modality: LEGAL_OPERATIVE_MODALITIES.DUTY,
              action: "Tổ chức thanh tra định kỳ hằng năm",
              sourceRefs: [outOfScopeRef],
            },
          ],
          applicabilityConditions: [
            "Khi cơ quan nhà nước thực hiện thanh tra định kỳ",
          ],
          qualifiers: [],
          exceptions: [],
          nonRepositoryDuty: true,
          coverage: {
            state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
            nonAssessableReason:
              "OUT_OF_SCOPE_TARGET: Nghĩa vụ thuộc cơ quan quản lý nhà nước, ngoài phạm vi phát triển.",
          },
          sourceRefs: [outOfScopeRef],
        },
      ],
      contextRelations: [],
      assessmentRules: [],
    });

    const submitInScopeRes = await httpRequest(app)
      .post(
        `/admin/legal-rule-catalog/${catalog.id}/scope-authorizations/submit`,
      )
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        ruleId: inScopeRuleId,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        expectedReviewRevision: 0,
        output: inScopeOutput,
        decisions: [
          {
            legalRequirementId: `${inScopeRuleId}:req-1`,
            stage: "DEVELOPMENT",
            technicalDeliverable:
              "Training and evaluation log retention policy",
            rationale:
              "Applies directly to AI development pipeline log retention",
            sourceSupport: [
              {
                chunkId: inScopeChunkId,
                startOffset: 0,
                endOffset: inScopeChunkText.length,
                contentSha256: sha256(inScopeChunkText),
              },
            ],
          },
        ],
      });
    assert.equal(
      submitInScopeRes.status,
      200,
      JSON.stringify(submitInScopeRes.body),
    );
    const submittedInScope = successBody<{
      scopeKey: string;
      decisionDigest: string;
      revision: number;
    }>(submitInScopeRes);

    const readInScopeRes = await httpRequest(app)
      .get(
        `/admin/legal-rule-catalog/${catalog.id}/scope-authorizations/${submittedInScope.scopeKey}`,
      )
      .set("Authorization", `Bearer ${reviewerToken}`);
    assert.equal(readInScopeRes.status, 200);

    const approveInScopeRes = await httpRequest(app)
      .post(
        `/admin/legal-rule-catalog/${catalog.id}/scope-authorizations/approve`,
      )
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        ruleId: inScopeRuleId,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        scopeKey: submittedInScope.scopeKey,
        expectedReviewRevision: submittedInScope.revision,
        decisionDigest: submittedInScope.decisionDigest,
        confirmsLegalReview: true,
      });
    assert.equal(approveInScopeRes.status, 200);
    assert.equal(
      successBody<{ state: string }>(approveInScopeRes).state,
      PreparationScopeReviewState.APPROVED,
    );

    const submitOutOfScopeRes = await httpRequest(app)
      .post(
        `/admin/legal-rule-catalog/${catalog.id}/scope-authorizations/submit`,
      )
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        ruleId: outOfScopeRuleId,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        expectedReviewRevision: 0,
        output: outOfScopeOutput,
        decisions: [
          {
            legalRequirementId: `${outOfScopeRuleId}:req-1`,
            stage: "NON_DEVELOPMENT",
            technicalDeliverable: null,
            rationale:
              "State regulator inspection duty, outside development scope",
            sourceSupport: [
              {
                chunkId: outOfScopeChunkId,
                startOffset: 0,
                endOffset: outOfScopeChunkText.length,
                contentSha256: sha256(outOfScopeChunkText),
              },
            ],
          },
        ],
      });
    assert.equal(submitOutOfScopeRes.status, 200);
    const submittedOutOfScope = successBody<{
      scopeKey: string;
      decisionDigest: string;
      revision: number;
    }>(submitOutOfScopeRes);

    const approveOutOfScopeRes = await httpRequest(app)
      .post(
        `/admin/legal-rule-catalog/${catalog.id}/scope-authorizations/approve`,
      )
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        ruleId: outOfScopeRuleId,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        scopeKey: submittedOutOfScope.scopeKey,
        expectedReviewRevision: submittedOutOfScope.revision,
        decisionDigest: submittedOutOfScope.decisionDigest,
        confirmsLegalReview: true,
      });
    assert.equal(approveOutOfScopeRes.status, 200);

    // 3. Model-free JSON Import (verified in-scope item + verified out-of-scope exclusion).
    const importRes = await httpRequest(app)
      .post(`/admin/legal-rule-catalog/${catalog.id}/assessment-rules/import`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        schemaVersion: C.ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION,
        catalogVersionId: catalog.id,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        legalSourceVersionId: draftSource.id,
        dryRun: false,
        items: [inScopeImportItem],
        excludedItems: [
          {
            ruleId: outOfScopeRuleId,
            reasonCode: C.ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.OUT_OF_SCOPE,
            reason: "Regulator inspection duty outside development scope",
          },
        ],
      });
    assert.equal(importRes.status, 200);
    const imported = successBody<C.AssessmentRuleImportResult>(importRes);
    assert.equal(imported.imported.length, 1);
    assert.ok(imported.imported[0].resultId);

    // 4. Grouping & Development activation.
    const activateRuleSetRes = await httpRequest(app)
      .post(`/admin/legal-rule-catalog/${catalog.id}/assessment-rules/activate`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        expectedRevision: outOfScopeSaved.catalogRevision,
        idempotencyKey: randomUUID(),
        results: [
          {
            ruleId: inScopeRuleId,
            resultId: imported.imported[0].resultId,
            revision: imported.imported[0].revision,
          },
        ],
      });
    assert.equal(
      activateRuleSetRes.status,
      200,
      JSON.stringify(activateRuleSetRes.body),
    );
    const activatedRuleSet =
      successBody<C.LegalRuleActivationResult>(activateRuleSetRes);
    assert.ok(activatedRuleSet.ruleSetVersionId);

    const persistedRuleSet =
      await prisma.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: activatedRuleSet.ruleSetVersionId },
      });
    assert.equal(
      persistedRuleSet.targetActivityScope,
      PreparationTargetActivityScope.DEVELOPMENT_ONLY,
    );
    assert.equal(persistedRuleSet.legalSourceVersionId, draftSource.id);

    // 5. New Assessment with admitted legal pins.
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    const customerToken =
      successBody<SignInSuccess>(signIn)?.session_token ?? "";
    assert.ok(customerToken, "customer sign-in must succeed");

    const createAssessmentRes = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name: "VN Corpus Admitted Assessment" });
    assert.equal(createAssessmentRes.status, 201);
    const createdAssessment =
      successBody<AssessmentDetail>(createAssessmentRes);
    assert.equal(
      createdAssessment.lifecycle?.state,
      ASSESSMENT_LIFECYCLE_STATES.PREPARING,
    );

    const persistedAssessment = await prisma.assessment.findUniqueOrThrow({
      where: { id: createdAssessment.assessment_id },
      include: {
        domainCase: {
          include: {
            ruleSet: {
              select: {
                id: true,
                legalSourceVersionId: true,
                targetActivityScope: true,
              },
            },
          },
        },
      },
    });
    if (persistedAssessment.domainCase) {
      assert.equal(
        persistedAssessment.domainCase.ruleSetVersionId,
        activatedRuleSet.ruleSetVersionId,
      );
      assert.equal(
        persistedAssessment.domainCase.ruleSet?.legalSourceVersionId,
        draftSource.id,
      );
      assert.equal(
        persistedAssessment.domainCase.ruleSet?.targetActivityScope,
        PreparationTargetActivityScope.DEVELOPMENT_ONLY,
      );
    }
  });
});
