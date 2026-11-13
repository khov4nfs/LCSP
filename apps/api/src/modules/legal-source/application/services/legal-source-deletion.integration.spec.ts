import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  AgentExecutionState,
  ArtifactLifecycleState,
  AssessmentLifecycleState,
  AuthUserRole,
  ComplianceRuleSetValidationOutcome,
  LegalSourceLifecycleStatus,
  LegalRequirementCoverageState,
  OutboxAggregateType,
  OutboxStatus,
  PrismaClient,
  UserAccessStatus,
} from "@prisma/client";
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import {
  LEGAL_SOURCE_DELETION_ERROR_CODES,
  LEGAL_SOURCE_DELETION_REASON_CODES,
  LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
  LEGAL_SOURCE_EVENT_TYPES,
} from "@lcsp/contracts/legal-source";
import { AUDIT_EVENT_TYPES } from "@lcsp/contracts/audit";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { LegalSourceDeletionService } from "./legal-source-deletion.service.js";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://unused/unused");
const isolated =
  url.hostname === "127.0.0.1" &&
  url.port === "55445" &&
  url.pathname === "/lcsp365_legal_source_deletion_test";
const database = isolated ? describe : describe.skip;

const actorId = "lcsp365-deletion-test-operator";
const digest = "a".repeat(64);

database("Legal Source permanent deletion PostgreSQL integration", () => {
  let prisma: PrismaClient;
  let service: LegalSourceDeletionService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }),
    });
    await prisma.$connect();
    const prismaService = prisma as unknown as PrismaService;
    service = new LegalSourceDeletionService(
      prismaService,
      new AuditWriterService(prismaService),
      new OutboxRepository(prismaService),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("deletes an active source, generated preparation tree, immutable inventory, and preserves audit/outbox receipt", async () => {
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const supersededVersionId = randomUUID();
    const runId = randomUUID();
    const ruleSetId = randomUUID();
    const unrelatedRunId = randomUUID();
    const unrelatedRuleSetId = randomUUID();
    const idempotencyKey = randomUUID();
    const versionName = `lcsp365-delete-${randomUUID()}`;
    const source = await prisma.legalSource.create({
      data: {
        id: sourceId,
        slug: `delete-${randomUUID()}`,
        name: "Deletion integration source",
      },
    });
    const unrelatedSource = await prisma.legalSource.create({
      data: {
        slug: `unrelated-${randomUUID()}`,
        name: "Unrelated source",
      },
    });
    const unrelatedVersion = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: unrelatedSource.id,
        version: `lcsp365-unrelated-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: unrelatedRunId,
        idempotencyKey: randomUUID(),
        legalSourceVersionId: unrelatedVersion.id,
        requestedBy: actorId,
        correlationId: randomUUID(),
        executionState: AgentExecutionState.SUCCEEDED,
      },
    });
    await prisma.complianceRuleSetVersion.create({
      data: {
        id: unrelatedRuleSetId,
        version: `lcsp365-unrelated-rules-${randomUUID()}`,
        legalSourceVersionId: unrelatedVersion.id,
        preparationRunId: unrelatedRunId,
        ruleSetDigest: digest,
      },
    });
    await prisma.legalSourceVersion.create({
      data: {
        id: versionId,
        legalSourceId: source.id,
        version: versionName,
        status: LegalSourceLifecycleStatus.ACTIVE,
        activatedAt: new Date(),
        sourceManifest: {},
      },
    });
    await prisma.legalSourceVersion.create({
      data: {
        id: supersededVersionId,
        legalSourceId: source.id,
        version: `lcsp365-delete-old-${randomUUID()}`,
        status: LegalSourceLifecycleStatus.SUPERSEDED,
        sourceManifest: {},
      },
    });
    await prisma.legalSourceActivationRecord.create({
      data: {
        id: randomUUID(),
        legalSourceVersionId: versionId,
        activatedBy: actorId,
        status: LegalSourceLifecycleStatus.ACTIVE,
        scopeDescription: "Disposable integration fixture",
      },
    });
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: runId,
        idempotencyKey: randomUUID(),
        legalSourceVersionId: versionId,
        requestedBy: actorId,
        correlationId: randomUUID(),
        executionState: AgentExecutionState.SUCCEEDED,
      },
    });
    await prisma.complianceRuleSetVersion.create({
      data: {
        id: ruleSetId,
        version: `lcsp365-rules-${randomUUID()}`,
        legalSourceVersionId: versionId,
        preparationRunId: runId,
        ruleSetDigest: digest,
      },
    });
    const requirementId = randomUUID();
    const assessmentRuleRowId = randomUUID();
    await prisma.legalRequirement.create({
      data: {
        id: requirementId,
        ruleSetVersionId: ruleSetId,
        legalRequirementId: `requirement-${randomUUID()}`,
        title: "Disposable requirement",
        proposition: "Test-only requirement content",
        applicabilityConditions: {},
        qualifiers: {},
        exceptions: {},
        nonRepositoryDuty: false,
        coverageState:
          LegalRequirementCoverageState.COVERED_BY_ASSESSMENT_RULES,
        contentDigest: digest,
        ordinal: 0,
      },
    });
    await prisma.assessmentRule.create({
      data: {
        id: assessmentRuleRowId,
        ruleSetVersionId: ruleSetId,
        assessmentRuleId: `assessment-rule-${randomUUID()}`,
        assessmentRuleVersion: "v1",
        concept: "Disposable test rule",
        legalIntent: "Test-only intent",
        applicabilityGuidance: "Test-only guidance",
        criteria: {},
        contract: {},
        sourceFingerprint: digest,
        contentDigest: digest,
        ordinal: 0,
      },
    });
    await prisma.assessmentRuleLegalRequirement.create({
      data: {
        ruleSetVersionId: ruleSetId,
        assessmentRuleRowId,
        legalRequirementRowId: requirementId,
      },
    });
    await prisma.ruleSetPreparationClaimInventory.create({
      data: {
        preparationRunId: runId,
        revision: 1,
        fingerprint: digest,
        graphDigest: digest,
        graph: {},
        identities: {},
      },
    });
    const outboxId = randomUUID();
    await prisma.outboxMessage.create({
      data: {
        id: outboxId,
        aggregateType: OutboxAggregateType.LEGAL_SOURCE_VERSION,
        aggregateId: versionId,
        eventType: LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
        payload: {},
      },
    });
    const publishedOutboxId = randomUUID();
    await prisma.outboxMessage.create({
      data: {
        id: publishedOutboxId,
        aggregateType: OutboxAggregateType.LEGAL_SOURCE_VERSION,
        aggregateId: versionId,
        eventType: LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
        payload: {},
        status: OutboxStatus.PUBLISHED,
        attempts: 1,
        publishedAt: new Date(),
      },
    });

    const impact = await service.getImpact(sourceId, randomUUID());
    const request = {
      expectedImpactEtag: impact.snapshot.etag,
      confirmationSlug: source.slug,
      reason: {
        code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
        text: "Disposable integration test cleanup",
      },
      idempotencyKey,
    };
    const result = await service.deleteSource({
      sourceId,
      actorId,
      correlationId: randomUUID(),
      request,
    });

    expect(result.deletedVersionIds).toEqual(
      expect.arrayContaining([versionId, supersededVersionId]),
    );
    expect(result.deletedVersionIds).toHaveLength(2);
    expect(await prisma.legalSource.count({ where: { id: sourceId } })).toBe(0);
    expect(
      await prisma.legalSourceVersion.count({ where: { id: versionId } }),
    ).toBe(0);
    expect(
      await prisma.legalSourceVersion.count({
        where: { id: supersededVersionId },
      }),
    ).toBe(0);
    expect(
      await prisma.legalSourceActivationRecord.count({
        where: { legalSourceVersionId: versionId },
      }),
    ).toBe(0);
    expect(
      await prisma.ruleSetPreparationRun.count({ where: { id: runId } }),
    ).toBe(0);
    expect(
      await prisma.legalSource.count({ where: { id: unrelatedSource.id } }),
    ).toBe(1);
    expect(
      await prisma.legalSourceVersion.count({
        where: { id: unrelatedVersion.id },
      }),
    ).toBe(1);
    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { id: unrelatedRunId },
      }),
    ).toBe(1);
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { id: unrelatedRuleSetId },
      }),
    ).toBe(1);
    expect(
      await prisma.complianceRuleSetVersion.count({ where: { id: ruleSetId } }),
    ).toBe(0);
    expect(
      await prisma.legalRequirement.count({
        where: { id: requirementId },
      }),
    ).toBe(0);
    expect(
      await prisma.assessmentRule.count({
        where: { id: assessmentRuleRowId },
      }),
    ).toBe(0);
    expect(
      await prisma.assessmentRuleLegalRequirement.count({
        where: { assessmentRuleRowId },
      }),
    ).toBe(0);
    expect(
      await prisma.ruleSetPreparationClaimInventory.count({
        where: { preparationRunId: runId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.outboxMessage.findUniqueOrThrow({
          where: { id: outboxId },
        })
      ).status,
    ).toBe(OutboxStatus.CANCELLED);
    expect(
      (
        await prisma.outboxMessage.findUniqueOrThrow({
          where: { id: publishedOutboxId },
        })
      ).status,
    ).toBe(OutboxStatus.PUBLISHED);
    const receipt = await prisma.legalSourceDeletionReceipt.findUniqueOrThrow({
      where: { idempotencyKey },
    });
    expect(
      await prisma.auditEvent.count({ where: { id: receipt.auditEventId } }),
    ).toBe(1);
    expect(
      await prisma.legalSourceDeletionReceipt.count({
        where: { idempotencyKey },
      }),
    ).toBe(1);

    const replay = await service.deleteSource({
      sourceId,
      actorId,
      correlationId: randomUUID(),
      request,
    });
    expect(replay.deletionReceiptId).toBe(result.deletionReceiptId);
    expect(replay.idempotentReplay).toBe(true);
    expect(
      await prisma.auditEvent.count({
        where: {
          eventType: AUDIT_EVENT_TYPES.legalSourceDeleted,
          resourceId: sourceId,
        },
      }),
    ).toBe(1);
  });

  it("keeps the source and version when a preparation run is deleted independently", async () => {
    const source = await prisma.legalSource.create({
      data: {
        slug: `independent-${randomUUID()}`,
        name: "Independent child deletion fixture",
      },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `lcsp365-independent-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const run = await prisma.ruleSetPreparationRun.create({
      data: {
        idempotencyKey: randomUUID(),
        legalSourceVersionId: version.id,
        requestedBy: actorId,
        correlationId: randomUUID(),
        executionState: AgentExecutionState.SUCCEEDED,
      },
    });

    await prisma.ruleSetPreparationRun.delete({ where: { id: run.id } });
    expect(
      await prisma.legalSource.findUnique({ where: { id: source.id } }),
    ).not.toBeNull();
    expect(
      await prisma.legalSourceVersion.findUnique({ where: { id: version.id } }),
    ).not.toBeNull();

    const impact = await service.getImpact(source.id, randomUUID());
    await service.deleteSource({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: impact.snapshot.etag,
        confirmationSlug: source.slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Disposable integration test cleanup",
        },
        idempotencyKey: randomUUID(),
      },
    });
  });

  it("does not permit independent Rule Set deletion and leaves its Legal Source intact", async () => {
    const source = await prisma.legalSource.create({
      data: {
        slug: `ruleset-direction-${randomUUID()}`,
        name: "Rule Set direction fixture",
      },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `lcsp365-ruleset-direction-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const run = await prisma.ruleSetPreparationRun.create({
      data: {
        idempotencyKey: randomUUID(),
        legalSourceVersionId: version.id,
        requestedBy: actorId,
        correlationId: randomUUID(),
        executionState: AgentExecutionState.SUCCEEDED,
      },
    });
    const ruleSet = await prisma.complianceRuleSetVersion.create({
      data: {
        version: `lcsp365-ruleset-direction-${randomUUID()}`,
        legalSourceVersionId: version.id,
        preparationRunId: run.id,
        ruleSetDigest: digest,
      },
    });

    await expect(
      prisma.complianceRuleSetVersion.delete({ where: { id: ruleSet.id } }),
    ).rejects.toThrow();
    expect(
      await prisma.legalSource.findUnique({ where: { id: source.id } }),
    ).not.toBeNull();
    expect(
      await prisma.legalSourceVersion.findUnique({ where: { id: version.id } }),
    ).not.toBeNull();

    const impact = await service.getImpact(source.id, randomUUID());
    await service.deleteSource({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: impact.snapshot.etag,
        confirmationSlug: source.slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Delete source-owned Rule Set tree",
        },
        idempotencyKey: randomUUID(),
      },
    });
  });

  it("permanently deletes a source with no versions", async () => {
    const source = await prisma.legalSource.create({
      data: { slug: `empty-${randomUUID()}`, name: "Empty source fixture" },
    });
    const impact = await service.getImpact(source.id, randomUUID());
    expect(impact.versionCounts.total).toBe(0);
    const result = await service.deleteSource({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: impact.snapshot.etag,
        confirmationSlug: source.slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Remove empty disposable source",
        },
        idempotencyKey: randomUUID(),
      },
    });
    expect(result.deletedVersionIds).toEqual([]);
    expect(
      await prisma.legalSource.findUnique({ where: { id: source.id } }),
    ).toBeNull();
  });

  it("permanently deletes a source containing a DRAFT version", async () => {
    const source = await prisma.legalSource.create({
      data: { slug: `delete-draft-${randomUUID()}`, name: "Draft source" },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `lcsp365-draft-${randomUUID()}`,
        status: LegalSourceLifecycleStatus.DRAFT,
        sourceManifest: {},
      },
    });
    const impact = await service.getImpact(source.id, randomUUID());
    await service.deleteSource({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: impact.snapshot.etag,
        confirmationSlug: source.slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Disposable integration test cleanup",
        },
        idempotencyKey: randomUUID(),
      },
    });
    expect(
      await prisma.legalSourceVersion.count({ where: { id: version.id } }),
    ).toBe(0);
    expect(await prisma.legalSource.count({ where: { id: source.id } })).toBe(
      0,
    );
  });

  it("settles simultaneous duplicate requests to one deletion receipt", async () => {
    const source = await prisma.legalSource.create({
      data: {
        slug: `delete-race-${randomUUID()}`,
        name: "Concurrent deletion source",
      },
    });
    const impact = await service.getImpact(source.id, randomUUID());
    const request = {
      expectedImpactEtag: impact.snapshot.etag,
      confirmationSlug: source.slug,
      reason: {
        code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
        text: "Concurrent disposable integration test cleanup",
      },
      idempotencyKey: randomUUID(),
    };
    const attempts = await Promise.allSettled(
      [0, 1].map(() =>
        service.deleteSource({
          sourceId: source.id,
          actorId,
          correlationId: randomUUID(),
          request,
        }),
      ),
    );
    const completed = attempts.filter(
      (
        attempt,
      ): attempt is PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.deleteSource>>
      > => attempt.status === "fulfilled",
    );

    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(0);
    expect(completed).toHaveLength(2);
    expect(completed[0].value.deletionReceiptId).toBe(
      completed[1].value.deletionReceiptId,
    );
    expect(
      await prisma.legalSourceDeletionReceipt.count({
        where: { idempotencyKey: request.idempotencyKey },
      }),
    ).toBe(1);
    expect(await prisma.legalSource.count({ where: { id: source.id } })).toBe(
      0,
    );
  });

  it("blocks a protected Assessment reference without partially deleting source or Rule Set data", async () => {
    const userId = randomUUID();
    const source = await prisma.legalSource.create({
      data: {
        slug: `protected-${randomUUID()}`,
        name: "Protected assessment fixture",
      },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `lcsp365-protected-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const run = await prisma.ruleSetPreparationRun.create({
      data: {
        idempotencyKey: randomUUID(),
        legalSourceVersionId: version.id,
        requestedBy: actorId,
        correlationId: randomUUID(),
        executionState: AgentExecutionState.SUCCEEDED,
      },
    });
    const ruleSet = await prisma.complianceRuleSetVersion.create({
      data: {
        version: `lcsp365-protected-rules-${randomUUID()}`,
        legalSourceVersionId: version.id,
        preparationRunId: run.id,
        lifecycleState: ArtifactLifecycleState.ACTIVE,
        ruleSetDigest: digest,
        validationOutcome: ComplianceRuleSetValidationOutcome.PASSED,
        validatedAt: new Date(),
        activatedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "test-only-hash",
        emailVerified: true,
        failedLoginCount: 0,
        role: AuthUserRole.CUSTOMER,
        accessStatus: UserAccessStatus.ACTIVE,
      },
    });
    const assessmentId = randomUUID();
    await prisma.assessment.create({
      data: {
        id: assessmentId,
        ownerId: userId,
        name: "Protected test assessment",
        lifecycleState: AssessmentLifecycleState.COMPLETE,
        lifecycleRevision: 0,
      },
    });
    await prisma.assessmentCase.create({
      data: { assessmentId, ruleSetVersionId: ruleSet.id },
    });

    const impact = await service.getImpact(source.id, randomUUID());
    await expect(
      service.deleteSource({
        sourceId: source.id,
        actorId,
        correlationId: randomUUID(),
        request: {
          expectedImpactEtag: impact.snapshot.etag,
          confirmationSlug: source.slug,
          reason: {
            code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
            text: "Blocked protected-reference integration case",
          },
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({
      response: {
        problem: { code: LEGAL_SOURCE_DELETION_ERROR_CODES.deletionBlocked },
      },
    });

    expect(
      await prisma.legalSource.findUnique({ where: { id: source.id } }),
    ).not.toBeNull();
    expect(
      await prisma.legalSourceVersion.findUnique({ where: { id: version.id } }),
    ).not.toBeNull();
    expect(
      await prisma.ruleSetPreparationRun.findUnique({ where: { id: run.id } }),
    ).not.toBeNull();
    expect(
      await prisma.complianceRuleSetVersion.findUnique({
        where: { id: ruleSet.id },
      }),
    ).not.toBeNull();

    await prisma.assessment.delete({ where: { id: assessmentId } });
    await prisma.user.delete({ where: { id: userId } });
    const retryImpact = await service.getImpact(source.id, randomUUID());
    await service.deleteSource({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: retryImpact.snapshot.etag,
        confirmationSlug: source.slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Clean up after protected-reference integration case",
        },
        idempotencyKey: randomUUID(),
      },
    });
  });

  it("rolls back all source, receipt, audit and outbox writes when audit persistence fails", async () => {
    const source = await prisma.legalSource.create({
      data: {
        slug: `rollback-${randomUUID()}`,
        name: "Audit rollback fixture",
      },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `lcsp365-rollback-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const impact = await service.getImpact(source.id, randomUUID());
    const idempotencyKey = randomUUID();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION public.lcsp_test_fail_legal_source_delete_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."eventType" = 'LEGAL_SOURCE_DELETED' THEN
          RAISE EXCEPTION 'injected legal-source deletion audit failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER lcsp_test_fail_legal_source_delete_audit
      BEFORE INSERT ON public."AuditEvent"
      FOR EACH ROW EXECUTE FUNCTION public.lcsp_test_fail_legal_source_delete_audit()
    `);
    try {
      await expect(
        service.deleteSource({
          sourceId: source.id,
          actorId,
          correlationId: randomUUID(),
          request: {
            expectedImpactEtag: impact.snapshot.etag,
            confirmationSlug: source.slug,
            reason: {
              code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
              text: "Injected audit rollback test",
            },
            idempotencyKey,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS lcsp_test_fail_legal_source_delete_audit ON public."AuditEvent"`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS public.lcsp_test_fail_legal_source_delete_audit()`,
      );
    }

    expect(
      await prisma.legalSource.findUnique({ where: { id: source.id } }),
    ).not.toBeNull();
    expect(
      await prisma.legalSourceVersion.findUnique({ where: { id: version.id } }),
    ).not.toBeNull();
    expect(
      await prisma.legalSourceDeletionReceipt.count({
        where: { idempotencyKey },
      }),
    ).toBe(0);
    expect(
      await prisma.outboxMessage.count({
        where: {
          aggregateId: source.id,
          eventType: LEGAL_SOURCE_EVENT_TYPES.legalSourceDeleted,
        },
      }),
    ).toBe(0);

    const retryImpact = await service.getImpact(source.id, randomUUID());
    await service.deleteSource({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: retryImpact.snapshot.etag,
        confirmationSlug: source.slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Cleanup after audit rollback test",
        },
        idempotencyKey: randomUUID(),
      },
    });
  });

  it("preserves a content-addressed original blob while another Legal Source still references it", async () => {
    const sha256 = createHash("sha256").update(randomUUID()).digest("hex");
    const documentIds = [
      `shared-document-a-${randomUUID()}`,
      `shared-document-b-${randomUUID()}`,
    ];
    await prisma.legalSourceDocumentBlob.create({
      data: { sha256, byteLength: 4, bytes: new Uint8Array([1, 2, 3, 4]) },
    });
    const sources = await Promise.all([
      prisma.legalSource.create({
        data: { slug: `blob-a-${randomUUID()}`, name: "Blob owner A" },
      }),
      prisma.legalSource.create({
        data: { slug: `blob-b-${randomUUID()}`, name: "Blob owner B" },
      }),
    ]);
    const versions = await Promise.all(
      sources.map((source, index) =>
        prisma.legalSourceVersion.create({
          data: {
            legalSourceId: source.id,
            version: `lcsp365-blob-${index}-${randomUUID()}`,
            sourceManifest: {},
          },
        }),
      ),
    );
    const documents = await Promise.all(
      versions.map((version, index) =>
        prisma.legalSourceDocument.create({
          data: {
            legalSourceVersionId: version.id,
            documentId: documentIds[index],
            title: `Shared original ${index}`,
            sourceUrl: "https://example.test/original.docx",
            sourceSha256: `sha256:${sha256}`,
            sourceEffectStatus: "UNVERIFIED_TEST_FIXTURE",
            blobSha256: sha256,
            byteLength: 4,
          },
        }),
      ),
    );
    await prisma.legalSourceSnapshot.create({
      data: {
        snapshotRef: `lcsp365-snapshot-ref-${randomUUID()}`,
        snapshotId: `lcsp365-snapshot-${randomUUID()}`,
        catalogSourceRef: "integration-test-source",
        adminCatalogVersion: "test-v1",
        documentId: documentIds[0],
        sourceUrl: "https://example.test/shared.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteLength: 4,
        contentSha256: sha256,
        snapshotObjectKey: `test/${sha256}`,
        provenanceRef: `test-provenance/${sha256}`,
        retrievedAt: new Date(),
        correlationId: randomUUID(),
      },
    });

    const firstImpact = await service.getImpact(sources[0].id, randomUUID());
    expect(firstImpact.sharedBlobs.referencedBySurvivingDocuments).toBe(1);
    expect(firstImpact.sharedBlobs.eligibleForGarbageCollection).toBe(0);
    const firstDelete = await service.deleteSource({
      sourceId: sources[0].id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: firstImpact.snapshot.etag,
        confirmationSlug: sources[0].slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Delete only one shared-blob owner",
        },
        idempotencyKey: randomUUID(),
      },
    });
    expect(firstDelete.retainedIndependentSnapshotCount).toBe(1);
    expect(
      await prisma.legalSourceSnapshot.count({
        where: { documentId: documentIds[0] },
      }),
    ).toBe(1);
    expect(
      await prisma.legalSourceDocument.findUnique({
        where: { id: documents[1].id },
      }),
    ).not.toBeNull();
    expect(
      await prisma.legalSourceDocumentBlob.findUnique({ where: { sha256 } }),
    ).not.toBeNull();

    const secondImpact = await service.getImpact(sources[1].id, randomUUID());
    expect(secondImpact.sharedBlobs.eligibleForGarbageCollection).toBe(1);
    await service.deleteSource({
      sourceId: sources[1].id,
      actorId,
      correlationId: randomUUID(),
      request: {
        expectedImpactEtag: secondImpact.snapshot.etag,
        confirmationSlug: sources[1].slug,
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
          text: "Delete final shared-blob owner",
        },
        idempotencyKey: randomUUID(),
      },
    });
    expect(
      await prisma.legalSourceDocumentBlob.findUnique({ where: { sha256 } }),
    ).toBeNull();
  });
});
