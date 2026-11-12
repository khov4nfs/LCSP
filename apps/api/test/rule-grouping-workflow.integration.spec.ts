import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { randomUUID, createHash } from "node:crypto";
import {
  PrismaClient,
  ArtifactLifecycleState,
  PreparationTargetActivityScope,
  AgentExecutionState,
  RuleSetPreparationFailureReason,
  LegalRequirementCoverageState,
  RuleCatalogGroupId,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AssessmentRuleAuditService } from "../src/modules/assessment/application/services/assessment-rule-audit.service.js";
import { AssessmentCaseSupport } from "../src/modules/assessment/infrastructure/persistence/assessment-case-support.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import {
  AuthoredLocalizationService,
  enqueueAuthoredDocument,
} from "../src/platform/localization/authored-localization.service.js";
import {
  RULE_AUDIT_SCOPE_MODES,
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
  type SubmitRuleAudit,
} from "@lcsp/contracts/assessment-domain";
import {
  AuthUserRole,
  AssessmentLifecycleState,
  AssessmentAuditMode,
  RepositoryScanTriggerSource,
  RepositoryScanJobStatus,
} from "@prisma/client";
import {
  RuleCatalogGroupsService,
  materializeGroupingProposal,
} from "../src/modules/compliance-rule-set/infrastructure/persistence/rule-catalog-groups.service.js";
import { PREPARATION_SCOPE_STAGES } from "@lcsp/contracts/compliance-rule-set";
import {
  RULE_CATALOG_REVIEW_STATES,
  type SubmitRuleCatalogGroups,
} from "@lcsp/contracts/assessment-domain";

const url = process.env.LCSP_TEST_LOCALIZATION_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration("persisted grouping proposal and independent review", () => {
  let db: PrismaClient,
    replica: PrismaClient,
    service: RuleCatalogGroupsService,
    other: RuleCatalogGroupsService;
  let id: string;
  const fingerprint = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== "127.0.0.1" ||
      !target.pathname.includes("lcsp347_localization_test")
    )
      throw new Error("Dedicated disposable database required");
    db = new PrismaClient({ adapter: new PrismaPg(url!) });
    replica = new PrismaClient({ adapter: new PrismaPg(url!) });
    await Promise.all([db.$connect(), replica.$connect()]);
    service = new RuleCatalogGroupsService(db as PrismaService);
    other = new RuleCatalogGroupsService(replica as PrismaService);
  });
  afterAll(async () => {
    if (id)
      await db.complianceRuleSetVersion.update({
        where: { id },
        data: {
          lifecycleState: ArtifactLifecycleState.SUPERSEDED,
          supersededAt: new Date(),
        },
      });
    await Promise.all([db?.$disconnect(), replica?.$disconnect()]);
  });
  it("creates no proposal for failed Preparation and rejects a foreign digest", async () => {
    const tag = randomUUID();
    const source = await db.legalSourceVersion.create({
      data: { version: `failed-group-fixture-${tag}`, sourceManifest: {} },
    });
    const run = await db.ruleSetPreparationRun.create({
      data: {
        legalSourceVersionId: source.id,
        requestedBy: "isolated-fixture",
        correlationId: tag,
        idempotencyKey: tag,
        targetActivityScope: PreparationTargetActivityScope.DEVELOPMENT_ONLY,
        executionState: AgentExecutionState.FAILED,
        failureReason: RuleSetPreparationFailureReason.RUNTIME_ERROR,
      },
    });
    const version = await db.complianceRuleSetVersion.create({
      data: {
        version: `failed-group-fixture-${tag}`,
        legalSourceVersionId: source.id,
        preparationRunId: run.id,
        ruleSetDigest: fingerprint(tag),
        targetActivityScope: PreparationTargetActivityScope.DEVELOPMENT_ONLY,
      },
    });
    await expect(
      db.$transaction((tx) =>
        materializeGroupingProposal(tx, version.id, version.ruleSetDigest),
      ),
    ).rejects.toThrow();
    await expect(
      db.$transaction((tx) =>
        materializeGroupingProposal(tx, version.id, fingerprint("foreign")),
      ),
    ).rejects.toThrow();
    expect(
      await db.ruleCatalogGroupingProposal.count({
        where: { ruleSetVersionId: version.id },
      }),
    ).toBe(0);
  });
  it("materializes an ACTIVE snapshot without assigning legal meaning, rejects stale/incomplete/self approval, then approves exact reviewed membership", async () => {
    const tag = randomUUID();
    // Synthetic authority fixture only. This is not legal gold or a model accuracy evaluation.
    const text =
      "Synthetic test instrument: a developer shall implement a test-only safeguard before release.";
    const source = await db.legalSourceVersion.create({
      data: { version: `group-fixture-${tag}`, sourceManifest: {} },
    });
    const document = await db.legalSourceDocument.create({
      data: {
        legalSourceVersionId: source.id,
        documentId: tag,
        title: "Synthetic grouping fixture",
        sourceUrl: "https://example.invalid/grouping-fixture",
        sourceSha256: fingerprint(text),
        sourceEffectStatus: "IN_FORCE",
      },
    });
    const chunk = await db.legalDocumentChunk.create({
      data: {
        id: randomUUID(),
        legalSourceVersionId: source.id,
        legalSourceDocumentId: document.id,
        documentId: tag,
        locator: "fixture-1",
        content: text,
        contentSha256: fingerprint(text),
        hierarchy: {},
        legalStatus: "ACTIVE",
      },
    });
    const run = await db.ruleSetPreparationRun.create({
      data: {
        legalSourceVersionId: source.id,
        requestedBy: "isolated-fixture",
        correlationId: tag,
        idempotencyKey: tag,
        targetActivityScope: PreparationTargetActivityScope.DEVELOPMENT_ONLY,
        executionState: AgentExecutionState.SUCCEEDED,
      },
    });
    const version = await db.complianceRuleSetVersion.create({
      data: {
        version: `group-fixture-${tag}`,
        legalSourceVersionId: source.id,
        preparationRunId: run.id,
        ruleSetDigest: fingerprint(tag),
        targetActivityScope: PreparationTargetActivityScope.DEVELOPMENT_ONLY,
      },
    });
    id = version.id;
    const requirement = await db.legalRequirement.create({
      data: {
        ruleSetVersionId: id,
        legalRequirementId: "fixture-duty",
        title: "Synthetic design safeguard",
        proposition: text,
        operativePropositions: [
          {
            actor: "Synthetic developer",
            action: "Implement the fixture safeguard before release",
          },
        ],
        applicabilityConditions: [],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        coverageState:
          LegalRequirementCoverageState.COVERED_BY_ASSESSMENT_RULES,
        contentDigest: fingerprint(text),
        ordinal: 0,
      },
    });
    await db.legalRequirementProvenance.create({
      data: {
        ruleSetVersionId: id,
        legalRequirementRowId: requirement.id,
        legalSourceVersionId: source.id,
        chunkId: chunk.id,
        documentId: tag,
        locator: chunk.locator,
        contentSha256: chunk.contentSha256,
        sourceEffectStatus: "IN_FORCE",
        ordinal: 0,
      },
    });
    const rule = await db.assessmentRule.create({
      data: {
        ruleSetVersionId: id,
        assessmentRuleId: "fixture-rule",
        assessmentRuleVersion: "1",
        concept: "Synthetic safeguard",
        legalIntent: text,
        applicabilityGuidance: "Synthetic fixture only",
        criteria: [],
        contract: {},
        sourceFingerprint: fingerprint(text),
        contentDigest: fingerprint(text),
        ordinal: 0,
      },
    });
    await db.assessmentRuleLegalRequirement.create({
      data: {
        ruleSetVersionId: id,
        assessmentRuleRowId: rule.id,
        legalRequirementRowId: requirement.id,
      },
    });
    const ruleTwo = await db.assessmentRule.create({
      data: {
        ruleSetVersionId: id,
        assessmentRuleId: "fixture-rule-2",
        assessmentRuleVersion: "1",
        concept: "Second synthetic safeguard",
        legalIntent: text,
        applicabilityGuidance: "Synthetic fixture only",
        criteria: [],
        contract: {},
        sourceFingerprint: fingerprint(text),
        contentDigest: fingerprint("second-rule"),
        ordinal: 1,
      },
    });
    await db.assessmentRuleLegalRequirement.create({
      data: {
        ruleSetVersionId: id,
        assessmentRuleRowId: ruleTwo.id,
        legalRequirementRowId: requirement.id,
      },
    });
    await expect(service.proposal(id, tag)).rejects.toThrow();
    expect(
      await db.ruleCatalogGroupingProposal.count({
        where: { ruleSetVersionId: id },
      }),
    ).toBe(0);
    await db.$transaction(async (tx) => {
      await tx.complianceRuleSetVersion.update({
        where: { id },
        data: {
          lifecycleState: ArtifactLifecycleState.ACTIVE,
          activatedAt: new Date(),
        },
      });
      await materializeGroupingProposal(tx, id, version.ruleSetDigest);
    });
    const proposal = await service.proposal(id, tag);
    expect(proposal.entries[0].proposedGroupId).toBeNull();
    expect(proposal.entries[0].state).toBe(
      RULE_CATALOG_REVIEW_STATES.REVIEW_REQUIRED,
    );
    expect(await other.proposal(id, tag)).toEqual(proposal);
    expect(
      await db.ruleCatalogGroupingProposal.count({
        where: { ruleSetVersionId: id },
      }),
    ).toBe(1);
    expect((await service.get(id)).memberships).toHaveLength(0);
    expect(
      (await service.pending()).versions.some(
        (row) => row.ruleSetVersionId === id,
      ),
    ).toBe(true);
    const membership = {
      assessmentRuleId: rule.assessmentRuleId,
      assessmentRuleVersion: rule.assessmentRuleVersion,
      groupId: RuleCatalogGroupId.ARCHITECTURE_SAFETY_BY_DESIGN,
      taxonomyVersion: "LCSP_RULE_THEMES_V1",
      nameEn: "Architecture",
      nameVi: "Kiến trúc",
      descriptionEn: "Presentation only",
      descriptionVi: "Chỉ dùng trình bày",
      rationaleEn:
        "Administrator reviewed the synthetic pre-release responsibility.",
      rationaleVi:
        "Quản trị viên đã rà soát trách nhiệm giả lập trước phát hành.",
      actor: "Synthetic developer",
      lifecycleStage: PREPARATION_SCOPE_STAGES[0],
      sourceReferences: proposal.entries[0].sourceReferences,
      ordinal: 0,
    };
    const body: SubmitRuleCatalogGroups = {
      ruleSetDigest: version.ruleSetDigest,
      memberships: [
        membership,
        {
          ...membership,
          assessmentRuleId: ruleTwo.assessmentRuleId,
          ordinal: 1,
        },
      ],
    };
    await expect(
      service.submit(
        id,
        { ...body, ruleSetDigest: fingerprint("stale") },
        "submitter",
        tag,
      ),
    ).rejects.toThrow();
    await expect(
      service.submit(id, { ...body, memberships: [] }, "submitter", tag),
    ).rejects.toThrow();
    await expect(
      service.submit(
        id,
        {
          ...body,
          memberships: body.memberships.map((row, index) =>
            index === 0 ? { ...row, assessmentRuleVersion: "stale" } : row,
          ),
        },
        "submitter",
        tag,
      ),
    ).rejects.toThrow();
    await expect(
      service.submit(
        id,
        {
          ...body,
          memberships: body.memberships.map((row, index) =>
            index === 0 ? { ...row, actor: "foreign actor" } : row,
          ),
        },
        "submitter",
        tag,
      ),
    ).rejects.toThrow();
    await expect(
      service.submit(
        id,
        {
          ...body,
          memberships: body.memberships.map((row, index) =>
            index === 0 ? { ...row, sourceReferences: [] } : row,
          ),
        },
        "submitter",
        tag,
      ),
    ).rejects.toThrow();
    const submitted = await service.submit(id, body, "submitter", tag);
    const owner = randomUUID();
    await db.user.create({
      data: {
        id: owner,
        email: `${owner}@fixture.invalid`,
        passwordHash: "unused-fixture-hash",
        emailVerified: true,
        failedLoginCount: 0,
        role: AuthUserRole.CUSTOMER,
      },
    });
    const assessment = await db.assessment.create({
      data: {
        id: randomUUID(),
        ownerId: owner,
        name: "Controlled grouping journey",
        runtime: {
          create: {
            threadId: randomUUID(),
            rootAgentVersion: "isolated-fixture",
            checkpointNamespace: randomUUID(),
          },
        },
      },
    });
    const connection = await db.repositoryConnection.create({
      data: {
        id: randomUUID(),
        assessmentId: assessment.id,
        userId: owner,
        installationId: tag,
        repositoryId: tag,
        repositoryName: "fixture",
        repositoryFullName: "fixture/grouping",
        defaultBranch: "main",
        permissions: {},
      },
    });
    const snapshot = await db.repositorySnapshot.create({
      data: {
        id: randomUUID(),
        assessmentId: assessment.id,
        connectionId: connection.id,
        repositoryId: tag,
        repositoryFullName: "fixture/grouping",
        commitSha: "a".repeat(40),
        providerMetadata: {},
        actorId: owner,
      },
    });
    const scan = await db.repositoryScanJob.create({
      data: {
        id: randomUUID(),
        assessmentId: assessment.id,
        snapshotId: snapshot.id,
        idempotencyKey: randomUUID(),
        triggerSource: RepositoryScanTriggerSource.MANUAL,
        status: RepositoryScanJobStatus.COMPLETED,
        correlationId: tag,
      },
    });
    await db.assessmentCase.create({
      data: {
        repositoryScanJobId: scan.id,
        assessmentId: assessment.id,
        ruleSetVersionId: id,
        repositorySnapshotId: snapshot.id,
        repositoryCommit: snapshot.commitSha,
        auditMode: AssessmentAuditMode.CUSTOMER_SELECTED,
      },
    });
    await db.assessment.update({
      where: { id: assessment.id },
      data: {
        lifecycleState: AssessmentLifecycleState.ACTIVE,
        lifecycleRevision: 1,
      },
    });
    const localization = new AuthoredLocalizationService(db as PrismaService);
    const audit = new AssessmentRuleAuditService(
      db as PrismaService,
      new OutboxRepository(db as PrismaService),
      new AssessmentCaseSupport(),
      localization,
    );
    const selected: SubmitRuleAudit = {
      idempotencyKey: randomUUID(),
      expectedAuditRevision: 0,
      ruleSetVersionId: id,
      ruleSetDigest: version.ruleSetDigest,
      repositorySnapshotId: snapshot.id,
      repositoryCommit: snapshot.commitSha,
      scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
      rules: [
        {
          assessmentRuleId: rule.assessmentRuleId,
          assessmentRuleVersion: rule.assessmentRuleVersion,
        },
      ],
    };
    expect(
      (await audit.catalog(assessment.id, owner, tag, 0, 20, "en")).total,
    ).toBe(0);
    await expect(
      audit.submit(assessment.id, owner, tag, {
        ...selected,
        scopeMode: RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET,
        rules: [],
      }),
    ).rejects.toThrow();
    await expect(
      other.approve(id, submitted.membershipDigest, "submitter", tag),
    ).rejects.toThrow();
    await expect(
      other.approve(id, fingerprint("stale"), "reviewer", tag),
    ).rejects.toThrow();
    await db.$transaction(async (tx) => {
      for (const row of [rule, ruleTwo])
        await enqueueAuthoredDocument(tx, {
          scopeId: id,
          entityType: AUTHORED_LOCALIZATION_ENTITIES.ASSESSMENT_RULE,
          entityId: row.assessmentRuleId,
          canonicalRevision: row.contentDigest,
          document: row,
        });
      await enqueueAuthoredDocument(tx, {
        scopeId: id,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
        entityId: requirement.legalRequirementId,
        canonicalRevision: requirement.contentDigest,
        document: requirement,
      });
    });
    for (const job of await db.authoredLocalizationRequest.findMany({
      where: { scopeId: id, locale: "EN" },
    })) {
      await localization.reviewOutput(
        id,
        job.id,
        {
          originSha256: job.originSha256,
          contentSha256: job.originSha256,
          normalizedContent: job.originalContent,
          confirmsTargetLanguageAndMeaning: true,
          evidence: "Isolated English normalization review fixture",
        },
        "isolated-language-reviewer",
      );
    }
    const ungroupedEn = await audit.catalog(
      assessment.id,
      owner,
      tag,
      0,
      20,
      "en",
    );
    expect(ungroupedEn.total).toBe(0);
    expect(ungroupedEn.localizationState).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.READY,
    );
    const ungroupedVi = await audit.catalog(
      assessment.id,
      owner,
      tag,
      0,
      20,
      "vi",
    );
    expect(ungroupedVi.total).toBe(0);
    expect(ungroupedVi.localizationState).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.REVIEW_REQUIRED,
    );
    expect(
      await other.approve(id, submitted.membershipDigest, "reviewer", tag),
    ).toEqual({ state: RULE_CATALOG_REVIEW_STATES.APPROVED });
    expect((await service.get(id)).memberships[0].approvedBy).toBe("reviewer");
    expect(
      (await service.pending()).versions.some(
        (row) => row.ruleSetVersionId === id,
      ),
    ).toBe(false);
    await expect(service.submit(id, body, "submitter", tag)).rejects.toThrow();
    await expect(
      audit.catalog(assessment.id, owner, tag, 0, 20, "vi"),
    ).rejects.toThrow();
    const viJobs = await db.authoredLocalizationRequest.findMany({
      where: { scopeId: id, locale: "VI" },
    });
    const batchOutputOut = await localization.batchReviewOutput(
      id,
      {
        confirmsTargetLanguageAndMeaning: true,
        evidence:
          "Isolated reviewed localization fixture, not production approval",
        items: viJobs.map((job) => {
          const normalizedContent = `Bản giả lập được rà soát: ${job.originalContent}`;
          return {
            requestId: job.id,
            originSha256: job.originSha256,
            contentSha256: fingerprint(normalizedContent),
            normalizedContent,
          };
        }),
      },
      "isolated-language-reviewer",
    );
    expect(batchOutputOut.acceptedCount).toBe(viJobs.length);
    const ready = await audit.catalog(assessment.id, owner, tag, 0, 20, "en");
    expect(ready.total).toBe(2);
    expect(ready.localizationState).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.READY,
    );
    expect(ready.groups[0].count).toBe(2);
    const readyVi = await audit.catalog(assessment.id, owner, tag, 0, 20, "vi");
    expect(readyVi.total).toBe(2);
    expect(readyVi.localizationState).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.READY,
    );
    expect(readyVi.rules[0].concept).toContain("Bản giả lập được rà soát:");
    await expect(
      audit.catalog(assessment.id, "foreign-owner", tag, 0, 20, "en"),
    ).rejects.toThrow();
    await audit.submit(assessment.id, owner, tag, selected);
    const items = await db.assessmentRuleAuditItem.findMany({
      where: { request: { assessmentId: assessment.id } },
    });
    expect(items.map((item) => item.assessmentRuleId)).toEqual([
      rule.assessmentRuleId,
    ]);
    expect(items[0].assessmentRuleVersion).toBe(rule.assessmentRuleVersion);
  });
});
