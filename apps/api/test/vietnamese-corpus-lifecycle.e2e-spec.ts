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
  LegalSourceDocumentCorpusRole,
  PreparationScopeReviewState,
  PrismaClient,
} from "@prisma/client";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

    // Real text extraction from the verified official PDF (no hardcoded legal text).
    const extractedPdfText = execFileSync("pdftotext", [pdfPath, "-"], {
      encoding: "utf8",
    });
    const extractSlice = (startMarker: string, endMarker: string): string => {
      const start = extractedPdfText.indexOf(startMarker);
      assert.ok(start >= 0, `PDF must contain marker: ${startMarker}`);
      const end = extractedPdfText.indexOf(endMarker, start);
      assert.ok(end >= 0, `PDF must contain end marker: ${endMarker}`);
      return extractedPdfText.slice(start, end + endMarker.length);
    };

    const inScopeChunkText = extractSlice(
      "b) Độ tin cậy và chất lượng:",
      "trước khi triển khai.",
    );
    const outOfScopeChunkText = extractSlice(
      "2. Bộ Khoa học và Công nghệ chủ trì tổ chức triển khai",
      "tuân thủ đạo đức trí tuệ nhân tạo.",
    );
    assert.ok(extractedPdfText.includes(inScopeChunkText));
    assert.ok(extractedPdfText.includes(outOfScopeChunkText));

    await prisma.legalSourceDocumentBlob.create({
      data: {
        sha256: pdfDigest,
        byteLength: pdfBytes.byteLength,
        bytes: pdfBytes,
      },
    });

    const inScopeChunkId = "vn-chunk-art-3-1b";
    const outOfScopeChunkId = "vn-chunk-art-5-2";

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
                locator: "Điều 3 khoản 1 điểm b",
                content: inScopeChunkText,
                contentSha256: `sha256:${sha256(inScopeChunkText)}`,
                hierarchy: { article: "3", clause: "1", point: "b" },
                legalStatus: "ACTIVE",
              },
              {
                id: outOfScopeChunkId,
                locator: "Điều 5 khoản 2",
                content: outOfScopeChunkText,
                contentSha256: `sha256:${sha256(outOfScopeChunkText)}`,
                hierarchy: { article: "5", clause: "2" },
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
    const retrievalIndexRes = await httpRequest(app)
      .post(
        `/internal/legal-sources/${draftSource.id}/retrieval-indexes/validated`,
      )
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        version: `vn-05-2026-idx-${randomUUID().slice(0, 8)}`,
        configHash: sha256("vn-05-2026-config"),
        contentHash: sha256(`${inScopeChunkText}\n${outOfScopeChunkText}`),
        validationManifestRef: "retrieval-validation:vn-05-2026",
        validatedAt: new Date().toISOString(),
      });
    assert.equal(
      retrievalIndexRes.status,
      201,
      JSON.stringify(retrievalIndexRes.body),
    );

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
        legalRuleId: "VN-TT05-ART3-1B-QUALITY-TEST",
        expectedRevision: catalog.revision,
        title:
          "Kiểm thử, xác nhận và kiểm định nội bộ chất lượng dữ liệu, mô hình",
        description: inScopeChunkText,
        citationLocatorRefs: [
          {
            documentId: "05-2026-TT-BKHCN",
            locator: "Điều 3 khoản 1 điểm b",
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
        legalRuleId: "VN-TT05-ART5-2-MINISTRY-DUTY",
        expectedRevision: inScopeSaved.catalogRevision,
        title: "Trách nhiệm tổ chức triển khai của Bộ Khoa học và Công nghệ",
        description: outOfScopeChunkText,
        citationLocatorRefs: [
          {
            documentId: "05-2026-TT-BKHCN",
            locator: "Điều 5 khoản 2",
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
      locator: "Điều 3 khoản 1 điểm b",
      contentSha256: `sha256:${sha256(inScopeChunkText)}`,
    };
    const outOfScopeRef = {
      documentId: "05-2026-TT-BKHCN",
      locator: "Điều 5 khoản 2",
      contentSha256: `sha256:${sha256(outOfScopeChunkText)}`,
    };

    const inScopeImportItem: C.AssessmentRuleImportItem = {
      ruleId: inScopeRuleId,
      legalRequirements: [
        {
          legalRequirementId: `${inScopeRuleId}:req-1`,
          title:
            "Thiết lập tiêu chí chất lượng và kiểm định nội bộ trước khi triển khai",
          proposition: inScopeChunkText,
          operativePropositions: [
            {
              actor: "Tổ chức, cá nhân",
              modality: LEGAL_OPERATIVE_MODALITIES.DUTY,
              action:
                "Thiết lập tiêu chí chất lượng dữ liệu, mô hình, kết quả đầu ra và thực hiện kiểm thử, xác nhận, kiểm định nội bộ trước khi triển khai",
              sourceRefs: [inScopeRef],
            },
          ],
          applicabilityConditions: [
            "Trước khi triển khai hệ thống trí tuệ nhân tạo",
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
          concept:
            "Kiểm tra tiêu chí chất lượng và cơ chế kiểm thử, kiểm định nội bộ",
          legalRequirementIds: [`${inScopeRuleId}:req-1`],
          criteria: [
            {
              criterionId: "crit-1",
              legalRequirementIds: [`${inScopeRuleId}:req-1`],
            },
          ],
          evidenceBindings: [{ criterionId: "crit-1", kind: "REQUIRED" }],
          requiredEvidence: [
            "Tài liệu tiêu chí chất lượng dữ liệu, mô hình và kết quả kiểm thử nội bộ trước khi triển khai",
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
      analysis: "Điều 5 khoản 2 là trách nhiệm quản lý nhà nước của Bộ KH&CN.",
      legalRequirements: [
        {
          legalRequirementId: `${outOfScopeRuleId}:req-1`,
          title: "Bộ KH&CN chủ trì tổ chức triển khai Thông tư",
          proposition: outOfScopeChunkText,
          operativePropositions: [
            {
              actor: "Bộ Khoa học và Công nghệ",
              modality: LEGAL_OPERATIVE_MODALITIES.DUTY,
              action:
                "Chủ trì tổ chức triển khai, thực hiện Thông tư và ban hành hướng dẫn",
              sourceRefs: [outOfScopeRef],
            },
          ],
          applicabilityConditions: [
            "Khi cơ quan nhà nước tổ chức triển khai Thông tư 05/2026/TT-BKHCN",
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
              },
            },
          },
        },
      },
    });
    assert.ok(
      persistedAssessment.domainCase,
      "New Assessment must be pinned to the active ComplianceRuleSetVersion",
    );
    assert.equal(
      persistedAssessment.domainCase.ruleSetVersionId,
      activatedRuleSet.ruleSetVersionId,
    );
    assert.equal(
      persistedAssessment.domainCase.ruleSet?.legalSourceVersionId,
      draftSource.id,
    );

    // 6. Negative regression: valid official PDF SHA-256, but tampered chunk content / wrong locator / non-effective status must be rejected.
    const tamperedContentShaRes = await httpRequest(app)
      .post(
        `/admin/legal-rule-catalog/${catalog.id}/scope-authorizations/submit`,
      )
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        ruleId: inScopeRuleId,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        expectedReviewRevision: 0,
        output: {
          ...inScopeOutput,
          legalRequirements: [
            {
              ...inScopeOutput.legalRequirements[0],
              sourceRefs: [
                {
                  ...inScopeRef,
                  contentSha256: `sha256:${sha256("Nội dung bị thay đổi không thuộc PDF gốc")}`,
                },
              ],
            },
          ],
        },
        decisions: [
          {
            legalRequirementId: `${inScopeRuleId}:req-1`,
            stage: "DEVELOPMENT",
            technicalDeliverable: "Tampered test",
            rationale:
              "Should fail because contentSha256 does not match extracted PDF chunk",
            sourceSupport: [
              {
                chunkId: inScopeChunkId,
                startOffset: 0,
                endOffset: inScopeChunkText.length,
                contentSha256: sha256(
                  "Nội dung bị thay đổi không thuộc PDF gốc",
                ),
              },
            ],
          },
        ],
      });
    assert.equal(
      tamperedContentShaRes.status,
      422,
      `Tampered chunk hash must be rejected with 422, got ${tamperedContentShaRes.status}`,
    );
    assert.equal(
      (tamperedContentShaRes.body as { problem?: { code?: string } }).problem
        ?.code,
      C.LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
    );

    const wrongLocatorRes = await httpRequest(app)
      .post(`/admin/legal-rule-catalog/${catalog.id}/rules`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        legalRuleId: "VN-TT05-NONEXISTENT-LOCATOR",
        expectedRevision: outOfScopeSaved.catalogRevision,
        title: "Non-existent locator",
        description: "Should fail because Điều 99 does not exist in PDF",
        citationLocatorRefs: [
          {
            documentId: "05-2026-TT-BKHCN",
            locator: "Điều 99",
          },
        ],
      });
    assert.ok(
      wrongLocatorRes.status >= 400 && wrongLocatorRes.status < 500,
      `Non-existent locator must be rejected, got ${wrongLocatorRes.status}`,
    );

    // Non-effective (REPEALED) legal chunk must be rejected during scope authorization / import.
    await prisma.legalDocumentChunk.update({
      where: { id: inScopeChunkId },
      data: { legalEffectStatus: LegalEffectStatus.REPEALED },
    });
    const repealedChunkImportRes = await httpRequest(app)
      .post(`/admin/legal-rule-catalog/${catalog.id}/assessment-rules/import`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        schemaVersion: C.ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION,
        catalogVersionId: catalog.id,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        legalSourceVersionId: draftSource.id,
        dryRun: true,
        items: [inScopeImportItem],
        excludedItems: [],
      });
    assert.equal(
      repealedChunkImportRes.status,
      422,
      `REPEALED chunk must be rejected with 422, got ${repealedChunkImportRes.status}`,
    );
    assert.equal(
      (repealedChunkImportRes.body as { problem?: { code?: string } }).problem
        ?.code,
      C.LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
    );

    // Restore EFFECTIVE status so the REFERENCE_ONLY test is isolated from REPEALED.
    await prisma.legalDocumentChunk.update({
      where: { id: inScopeChunkId },
      data: { legalEffectStatus: LegalEffectStatus.EFFECTIVE },
    });

    await prisma.legalSourceDocument.updateMany({
      where: { legalSourceVersionId: draftSource.id },
      data: { corpusRole: LegalSourceDocumentCorpusRole.REFERENCE_ONLY },
    });
    const referenceOnlyRes = await httpRequest(app)
      .post(`/admin/legal-rule-catalog/${catalog.id}/assessment-rules/import`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        schemaVersion: C.ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION,
        catalogVersionId: catalog.id,
        expectedCatalogRevision: outOfScopeSaved.catalogRevision,
        legalSourceVersionId: draftSource.id,
        dryRun: true,
        items: [inScopeImportItem],
        excludedItems: [],
      });
    assert.equal(
      referenceOnlyRes.status,
      422,
      `REFERENCE_ONLY corpus role must be rejected with 422, got ${referenceOnlyRes.status}`,
    );
    assert.equal(
      (referenceOnlyRes.body as { problem?: { code?: string } }).problem?.code,
      C.LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
    );

    // Restore OPERATIVE corpusRole so the positive source remains clean.
    await prisma.legalSourceDocument.updateMany({
      where: { legalSourceVersionId: draftSource.id },
      data: { corpusRole: LegalSourceDocumentCorpusRole.OPERATIVE },
    });

    // Real PDF SHA-256 paired with fabricated chunk text having a self-consistent SHA-256:
    // verify fabricatedText is absent from extracted PDF text, and activating without
    // official extraction / retrieval validation fails closed.
    const fabricatedText =
      "Điều 88. Nội dung giả mạo không tồn tại trong Thông tư 05/2026/TT-BKHCN nhưng có hash tự nhất quán.";
    assert.equal(
      extractedPdfText.includes(fabricatedText),
      false,
      "Fabricated text must not exist in extracted PDF text",
    );
    const fabricatedDraftRes = await httpRequest(app)
      .post("/internal/legal-sources/validated-draft")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        version: `vn-tt-05-2026-fabricated-${randomUUID().slice(0, 8)}`,
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
                id: "vn-chunk-fabricated-88",
                locator: "Điều 88",
                content: fabricatedText,
                contentSha256: `sha256:${sha256(fabricatedText)}`,
                hierarchy: { article: "88" },
                legalStatus: "ACTIVE",
              },
            ],
          },
        ],
      });
    assert.equal(fabricatedDraftRes.status, 201);
    const fabricatedDraft = successBody<{ id: string }>(fabricatedDraftRes);
    // Register a retrieval index whose contentHash reflects the real PDF text rather than the fabricated chunk.
    const mismatchedRetrievalRes = await httpRequest(app)
      .post(
        `/internal/legal-sources/${fabricatedDraft.id}/retrieval-indexes/validated`,
      )
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        version: `vn-05-2026-fabricated-idx-${randomUUID().slice(0, 8)}`,
        configHash: sha256("vn-05-2026-config"),
        contentHash: sha256(extractedPdfText),
        validationManifestRef: "retrieval-validation:fabricated-mismatch",
        validatedAt: new Date().toISOString(),
      });
    assert.equal(mismatchedRetrievalRes.status, 201);
    const activateFabricatedRes = await httpRequest(app)
      .post(`/internal/legal-sources/${fabricatedDraft.id}/activate-validated`)
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        integrityManifestRef: "integrity-manifest:fabricated",
        retrievalValidationRef: "retrieval-validation:fabricated-mismatch",
        idempotencyKey: randomUUID(),
        scopeDescription: "Fabricated chunk negative regression",
      });
    assert.ok(
      activateFabricatedRes.status >= 400 && activateFabricatedRes.status < 500,
      `Fabricated chunk whose content differs from the verified PDF/retrieval hash must be rejected, got ${activateFabricatedRes.status}`,
    );
  });
});
