import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  AgentExecutionState,
  AuthUserRole,
  PreparationExecutionContract,
  Prisma,
  PrismaClient,
  RuleSetPreparationFailureReason,
} from "@prisma/client";
import {
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  complianceRuleSetPacketSchema,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_RULE_SELECTION_MODES,
  preparationRuleInputSchema,
  preparationRuleOutputSchema,
} from "@lcsp/contracts/legal-rule-catalog";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";
import { AssessmentRuntimePreparation } from "../../../assessment/application/services/assessment-runtime-preparation.service.js";
import { AssessmentCaseSupport } from "../../../assessment/infrastructure/persistence/assessment-case-support.service.js";
import { ComplianceRuleSetActivation } from "../../../compliance-rule-set/infrastructure/persistence/compliance-rule-set-activation.service.js";
import { validateComplianceRuleSetPacket } from "../../../compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";
import { ComplianceRuleSetReadModelLoader } from "../../../compliance-rule-set/infrastructure/persistence/compliance-rule-set-read-model.service.js";
import { LegalSourceSnapshotLoader } from "../../../compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { AuthoredLocalizationService } from "../../../../platform/localization/authored-localization.service.js";
import {
  legalSourceFactory,
  FIXTURE_DOCUMENT_ID,
} from "../../../../../test/support/compliance-rule-set-fixtures.js";
import {
  LegalRuleCatalogService,
  preparationInputFingerprint,
} from "./legal-rule-catalog.service.js";
import { PreparationRuleService } from "./preparation-rule.service.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const disposableDatabase = (() => {
  try {
    const url = new URL(databaseUrl);
    return (
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "55448" &&
      url.pathname === "/lcsp_r2_activation"
    );
  } catch {
    return false;
  }
})();
const describeDatabase = disposableDatabase ? describe : describe.skip;
type SeededResult = {
  legalRule: { id: string };
  result: { id: string };
};

let positiveThree: SeededResult;
let positiveOne: SeededResult;
let zero: SeededResult;
let stale: SeededResult;
let foreign: SeededResult;

describeDatabase(
  "selected LegalRule publication on disposable PostgreSQL",
  () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
    const db = prisma as unknown as PrismaService;
    const audit = new AuditWriterService(db);
    const outbox = new OutboxRepository(db);
    const graph = new LegalDocumentGraphService(db);
    // Catalog browsing and preparation share the same derived source authority.
    const catalogs = new LegalRuleCatalogService(db, audit, graph);
    const activation = new ComplianceRuleSetActivation(outbox, audit);
    const sourceSnapshot = new LegalSourceSnapshotLoader(db, graph);
    const preparation = new PreparationRuleService(
      db,
      catalogs,
      outbox,
      {} as never,
      sourceSnapshot,
      activation,
    );
    const readModel = new ComplianceRuleSetReadModelLoader(
      db,
      new AuthoredLocalizationService(db),
    );
    const runtimePreparation = new AssessmentRuntimePreparation(
      {} as never,
      outbox,
    );
    const assessmentSupport = new AssessmentCaseSupport();
    const runTag = `r2-${randomUUID()}`;
    const makeSource = legalSourceFactory(prisma, runTag);
    let actorId: string;
    const correlationId = randomUUID();
    let customerId: string;
    let catalogId: string;
    let sourceVersionId: string;
    let chunkId: string;
    let citation: {
      chunkId: string;
      documentId: string;
      locator: string;
      contentSha256: string;
      content: string;
    };

    beforeAll(async () => {
      await prisma.$connect();
      const user = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: `${randomUUID()}@test.invalid`,
          passwordHash: "test-only",
          emailVerified: true,
          failedLoginCount: 0,
          role: AuthUserRole.CUSTOMER,
        },
      });
      customerId = user.id;
      actorId = (
        await prisma.user.create({
          data: {
            id: randomUUID(),
            email: `${randomUUID()}@test.invalid`,
            passwordHash: "test-only",
            emailVerified: true,
            failedLoginCount: 0,
            role: AuthUserRole.ADMIN,
          },
        })
      ).id;

      const source = await makeSource(false, "DRAFT");
      sourceVersionId = source.id;
      const content = "a) Keep complete records for the required period.";
      const contentSha256 = `sha256:${createHash("sha256")
        .update(content, "utf8")
        .digest("hex")}`;
      const chunk = await prisma.legalDocumentChunk.findFirstOrThrow({
        where: {
          legalSourceVersionId: source.id,
          locator: "art-5::cl-1::pt-a",
        },
      });
      const updatedChunk = await prisma.legalDocumentChunk.update({
        where: { id: chunk.id },
        data: { content, contentSha256 },
      });
      await prisma.legalSourceVersion.update({
        where: { id: source.id },
        data: { status: "ACTIVE" },
      });
      chunkId = updatedChunk.id;
      citation = {
        chunkId,
        documentId: updatedChunk.documentId,
        locator: updatedChunk.locator,
        contentSha256,
        content,
      };
      const index = await prisma.legalRetrievalIndex.findFirstOrThrow({
        where: { legalSourceVersionId: source.id },
      });

      const catalog = await prisma.legalRuleCatalogVersion.create({
        data: {
          version: `catalog-${runTag}`,
          legalSourceVersionId: source.id,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      catalogId = catalog.id;

      const selection = await prisma.preparationRuleSelection.create({
        data: {
          catalogVersionId: catalog.id,
          catalogRevision: catalog.revision,
          createdBy: actorId,
          scope: { mode: LEGAL_RULE_SELECTION_MODES.ALL_MATCHING },
          inputs: [],
          fingerprint: "a".repeat(64),
        },
      });
      const batch = await prisma.preparationRuleBatch.create({
        data: {
          selectionId: selection.id,
          requestedBy: actorId,
          idempotencyKey: randomUUID(),
          requestHash: "b".repeat(64),
          items: [],
        },
      });

      const addResult = async (input: {
        name: string;
        assessmentRuleCount: number;
        executionState: AgentExecutionState;
        fingerprintState?: "CURRENT" | "STALE" | "FOREIGN";
      }) => {
        const legalRule = await prisma.legalRule.create({
          data: {
            id: randomUUID(),
            catalogVersionId: catalog.id,
            legalRuleId: `${input.name}-${randomUUID()}`,
            title: `Prepared source ${input.name}`,
            description: `Persisted ${input.name} result fixture.`,
            citationLocatorRefs: [
              {
                documentId: citation.documentId,
                locator: citation.locator,
              },
            ],
            authoredBy: actorId,
            updatedBy: actorId,
          },
        });
        const preparationRule = await prisma.preparationRule.create({
          data: { legalRuleId: legalRule.id },
        });
        const inputSnapshot = preparationRuleInputSchema.parse({
          ruleId: legalRule.id,
          legalRuleId: legalRule.legalRuleId,
          title: legalRule.title,
          description: legalRule.description,
          catalogVersionId: catalog.id,
          catalogVersion: catalog.version,
          catalogRevision: catalog.revision,
          legalSourceVersionId: source.id,
          sourceVersion: source.version,
          indexId: index.id,
          indexContentHash: index.contentHash,
          citations: [citation],
        });
        const resultInput =
          input.fingerprintState === "FOREIGN"
            ? preparationRuleInputSchema.parse({
                ...inputSnapshot,
                legalSourceVersionId: randomUUID(),
                sourceVersion: "foreign-source",
              })
            : inputSnapshot;
        const run = await prisma.ruleSetPreparationRun.create({
          data: {
            id: randomUUID(),
            idempotencyKey: randomUUID(),
            legalSourceVersionId: source.id,
            requestedBy: actorId,
            correlationId: randomUUID(),
            executionContract: PreparationExecutionContract.SELECTED_RULE_V1,
            executionState: input.executionState,
            ...(input.executionState === AgentExecutionState.FAILED
              ? { failureReason: RuleSetPreparationFailureReason.RUNTIME_ERROR }
              : {}),
            ...(input.executionState === AgentExecutionState.RUNNING
              ? { startedAt: new Date() }
              : {}),
            ...(input.executionState === AgentExecutionState.SUCCEEDED ||
            input.executionState === AgentExecutionState.FAILED
              ? { startedAt: new Date(), completedAt: new Date() }
              : {}),
          },
        });
        const output =
          input.executionState === AgentExecutionState.SUCCEEDED
            ? outputFor(legalRule.id, input.assessmentRuleCount, {
                documentId: citation.documentId,
                locator: citation.locator,
                contentSha256: citation.contentSha256,
              })
            : null;
        const fingerprint =
          input.fingerprintState === "STALE"
            ? "c".repeat(64)
            : preparationInputFingerprint(inputSnapshot);
        const result = await prisma.preparationRuleResult.create({
          data: {
            preparationRuleId: preparationRule.id,
            preparationRunId: run.id,
            batchId: batch.id,
            revision: 1,
            inputSnapshot: resultInput,
            inputFingerprint: fingerprint,
            ...(output === null ? { output: Prisma.DbNull } : { output }),
            ...(input.executionState === AgentExecutionState.FAILED
              ? { failureCode: "RUNTIME_ERROR" }
              : {}),
          },
        });
        return { legalRule, result };
      };

      // Two current successful results exercise replacement with 3 rules then 1 rule.
      positiveThree = await addResult({
        name: "positive-three",
        assessmentRuleCount: 3,
        executionState: AgentExecutionState.SUCCEEDED,
      });
      positiveOne = await addResult({
        name: "positive-one",
        assessmentRuleCount: 1,
        executionState: AgentExecutionState.SUCCEEDED,
      });
      zero = await addResult({
        name: "zero",
        assessmentRuleCount: 0,
        executionState: AgentExecutionState.SUCCEEDED,
      });
      stale = await addResult({
        name: "stale",
        assessmentRuleCount: 2,
        executionState: AgentExecutionState.SUCCEEDED,
        fingerprintState: "STALE",
      });
      await addResult({
        name: "failed",
        assessmentRuleCount: 0,
        executionState: AgentExecutionState.FAILED,
      });
      await addResult({
        name: "running",
        assessmentRuleCount: 0,
        executionState: AgentExecutionState.RUNNING,
      });
      foreign = await addResult({
        name: "foreign",
        assessmentRuleCount: 1,
        executionState: AgentExecutionState.SUCCEEDED,
        fingerprintState: "FOREIGN",
      });
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      await prisma.$disconnect();
    });

    it("filters exact persisted results, atomically replaces ACTIVE, and serves pinned Assessments", async () => {
      const firstPage = await catalogs.list(
        catalogId,
        { search: "", withAssessmentRules: true, page: 1, limit: 1 },
        correlationId,
      );
      const secondPage = await catalogs.list(
        catalogId,
        { search: "", withAssessmentRules: true, page: 2, limit: 1 },
        correlationId,
      );
      expect(firstPage.total).toBe(2);
      expect(firstPage.items[0]?.assessmentRuleCount).toBeGreaterThan(0);
      expect(secondPage.items).toHaveLength(1);
      expect(
        new Set([firstPage.items[0]?.id, secondPage.items[0]?.id]),
      ).toEqual(
        new Set([positiveThree.legalRule.id, positiveOne.legalRule.id]),
      );

      const allMatching = await catalogs.select(
        {
          catalogVersionId: catalogId,
          expectedRevision: 1,
          mode: LEGAL_RULE_SELECTION_MODES.ALL_MATCHING,
          filters: { search: "", withAssessmentRules: true },
          ruleIds: [],
        },
        actorId,
        correlationId,
      );
      expect(allMatching.selectedCount).toBe(2);

      const firstOutput = preparationRuleOutputSchema.parse(
        (
          await prisma.preparationRuleResult.findUniqueOrThrow({
            where: { id: positiveThree.result.id },
          })
        ).output,
      );
      const firstPacket = complianceRuleSetPacketSchema.parse({
        legalRequirements: firstOutput.legalRequirements,
        assessmentRules: firstOutput.assessmentRules,
        contextRelations: firstOutput.contextRelations,
      });
      const sourceForValidation = await prisma.$transaction((tx) =>
        sourceSnapshot.loadSelected(tx, sourceVersionId, firstPacket),
      );
      expect(
        validateComplianceRuleSetPacket(
          firstPacket,
          sourceForValidation.snapshot,
          () => false,
          { requireSemanticGraph: false },
        ).failures,
      ).toEqual([]);

      const firstRequest = activationRequest(positiveThree);
      const first = await preparation.activate(
        catalogId,
        firstRequest,
        actorId,
        correlationId,
      );
      const persistedFirst =
        await prisma.complianceRuleSetVersion.findUniqueOrThrow({
          where: { id: first.ruleSetVersionId },
          include: {
            rules: { include: { provenance: true } },
            assessmentRules: { include: { legalRequirementLinks: true } },
            activation: true,
          },
        });
      expect(persistedFirst.lifecycleState).toBe("ACTIVE");
      expect(persistedFirst.preparationRunId).toBeNull();
      expect(persistedFirst.selectedPreparationResults).toMatchObject([
        {
          ruleId: positiveThree.legalRule.id,
          resultId: positiveThree.result.id,
          revision: 1,
        },
      ]);
      expect(persistedFirst.rules).toHaveLength(3);
      expect(persistedFirst.assessmentRules).toHaveLength(3);
      expect(
        persistedFirst.assessmentRules[0]?.legalRequirementLinks,
      ).toHaveLength(1);
      expect(persistedFirst.rules[0]?.provenance[0]).toMatchObject({
        chunkId,
        documentId: FIXTURE_DOCUMENT_ID,
        locator: citation.locator,
        contentSha256: citation.contentSha256,
        sourceEffectStatus: "IN_FORCE",
        legalEffectStatus: "EFFECTIVE",
      });
      expect(persistedFirst.activation?.selectedPreparationResults).toEqual(
        persistedFirst.selectedPreparationResults,
      );

      const firstRead = await readModel.load(
        { id: first.ruleSetVersionId },
        correlationId,
      );
      expect(firstRead.assessmentRules).toHaveLength(3);
      expect(firstRead.assessmentRules[0]?.legalRequirementIds).toHaveLength(1);
      expect(firstRead.assessmentRules[0]?.sources[0]).toMatchObject({
        chunkId,
        locator: citation.locator,
        contentSha256: citation.contentSha256,
      });
      expect(firstRead.legalRequirements[0]?.sources[0]?.chunkId).toBe(chunkId);

      const oldAssessmentId = randomUUID();
      await prisma.assessment.create({
        data: {
          id: oldAssessmentId,
          ownerId: customerId,
          name: "Pinned before replacement",
          lifecycleState: "PREPARING",
          lifecycleRevision: 0,
        },
      });
      await prisma.$transaction((tx) =>
        runtimePreparation.createCaseInTx(tx, oldAssessmentId),
      );
      const oldCase = await prisma.assessmentCase.findUniqueOrThrow({
        where: { assessmentId: oldAssessmentId },
      });
      expect(oldCase.ruleSetVersionId).toBe(first.ruleSetVersionId);

      const replacementRequest = activationRequest(positiveOne);
      const failingEnqueue = jest
        .spyOn(outbox, "enqueue")
        .mockRejectedValueOnce(
          new Error("simulated transactional outbox failure"),
        );
      await expect(
        preparation.activate(
          catalogId,
          replacementRequest,
          actorId,
          correlationId,
        ),
      ).rejects.toThrow("simulated transactional outbox failure");
      failingEnqueue.mockRestore();
      expect(
        await prisma.complianceRuleSetVersion.findMany({
          where: { lifecycleState: "ACTIVE" },
          select: { id: true },
        }),
      ).toEqual([{ id: first.ruleSetVersionId }]);
      expect(
        await prisma.complianceRuleSetVersion.count({
          where: { legalSourceVersionId: sourceVersionId },
        }),
      ).toBe(1);

      const replacement = await preparation.activate(
        catalogId,
        replacementRequest,
        actorId,
        correlationId,
      );
      expect(replacement.previousActiveRuleSetVersionId).toBe(
        first.ruleSetVersionId,
      );
      const activeVersions = await prisma.complianceRuleSetVersion.findMany({
        where: { lifecycleState: "ACTIVE" },
        select: { id: true },
      });
      expect(activeVersions).toEqual([{ id: replacement.ruleSetVersionId }]);
      expect(
        await prisma.complianceRuleSetVersion.findUniqueOrThrow({
          where: { id: first.ruleSetVersionId },
        }),
      ).toMatchObject({ lifecycleState: "SUPERSEDED" });
      expect(
        await prisma.assessmentCase.findUniqueOrThrow({
          where: { assessmentId: oldAssessmentId },
        }),
      ).toMatchObject({ ruleSetVersionId: first.ruleSetVersionId });
      expect(
        await prisma.assessmentRule.count({
          where: { ruleSetVersionId: first.ruleSetVersionId },
        }),
      ).toBe(3);
      expect(
        await prisma.assessmentRule.count({
          where: { ruleSetVersionId: replacement.ruleSetVersionId },
        }),
      ).toBe(1);

      const newAssessmentId = randomUUID();
      await prisma.assessment.create({
        data: {
          id: newAssessmentId,
          ownerId: customerId,
          name: "Pinned after replacement",
          lifecycleState: "PREPARING",
          lifecycleRevision: 0,
        },
      });
      await prisma.$transaction((tx) =>
        runtimePreparation.createCaseInTx(tx, newAssessmentId),
      );
      const newCase = await prisma.assessmentCase.findUniqueOrThrow({
        where: { assessmentId: newAssessmentId },
      });
      expect(newCase.ruleSetVersionId).toBe(replacement.ruleSetVersionId);
      const assessmentRules = await prisma.assessmentRule.findMany({
        where: { ruleSetVersionId: newCase.ruleSetVersionId! },
        include: {
          legalRequirementLinks: { include: { legalRequirement: true } },
        },
      });
      expect(assessmentRules).toHaveLength(1);
      expect(assessmentRules[0]?.legalRequirementLinks).toHaveLength(1);
      const selectedOutput = preparationRuleOutputSchema.parse(
        (
          await prisma.preparationRuleResult.findUniqueOrThrow({
            where: { id: positiveOne.result.id },
          })
        ).output,
      );
      expect(assessmentRules[0]?.assessmentRuleId).toBe(
        selectedOutput.assessmentRules[0]?.assessmentRuleId,
      );
      expect(
        assessmentRules[0]?.legalRequirementLinks[0]?.legalRequirement
          .legalRequirementId,
      ).toBe(selectedOutput.assessmentRules[0]?.legalRequirementIds[0]);
      expect(assessmentRules[0]?.criteria).toEqual(
        selectedOutput.assessmentRules[0]?.criteria,
      );
      expect(assessmentRules[0]?.contract).toMatchObject({
        sourceChunkIds: [chunkId],
      });
      const identifiers = await prisma.$transaction((tx) =>
        assessmentSupport.ruleSetIdentifiers(tx, newCase.ruleSetVersionId!),
      );
      expect(identifiers).toHaveLength(2);

      const replay = await preparation.activate(
        catalogId,
        replacementRequest,
        actorId,
        correlationId,
      );
      expect(replay).toMatchObject({
        ruleSetVersionId: replacement.ruleSetVersionId,
        replayed: true,
      });
      expect(
        await prisma.complianceRuleSetVersion.count({
          where: { legalSourceVersionId: sourceVersionId },
        }),
      ).toBe(2);
      expect(
        await prisma.complianceRuleSetActivationRecord.count({
          where: {
            ruleSetVersionId: {
              in: [first.ruleSetVersionId, replacement.ruleSetVersionId],
            },
          },
        }),
      ).toBe(2);

      await expect(
        preparation.activate(
          catalogId,
          {
            ...activationRequest(foreign),
            results: [
              {
                ruleId: foreign.legalRule.id,
                resultId: foreign.result.id,
                revision: 1,
              },
            ],
          },
          actorId,
          correlationId,
        ),
      ).rejects.toBeDefined();
      await expect(
        preparation.activate(
          catalogId,
          {
            ...activationRequest(positiveThree),
            results: [
              {
                ruleId: positiveThree.legalRule.id,
                resultId: positiveThree.result.id,
                revision: 2,
              },
            ],
          },
          actorId,
          correlationId,
        ),
      ).rejects.toBeDefined();
      await expect(
        preparation.activate(
          catalogId,
          {
            ...activationRequest(stale),
            results: [
              {
                ruleId: stale.legalRule.id,
                resultId: stale.result.id,
                revision: 1,
              },
            ],
          },
          actorId,
          correlationId,
        ),
      ).rejects.toBeDefined();
      await expect(
        preparation.activate(
          catalogId,
          activationRequest(zero),
          actorId,
          correlationId,
        ),
      ).rejects.toBeDefined();
      expect(
        await prisma.complianceRuleSetVersion.findMany({
          where: { lifecycleState: "ACTIVE" },
          select: { id: true },
        }),
      ).toEqual([{ id: replacement.ruleSetVersionId }]);
    });
  },
);

function activationRequest(result: {
  legalRule: { id: string };
  result: { id: string };
}) {
  return {
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
    results: [
      {
        ruleId: result.legalRule.id,
        resultId: result.result.id,
        revision: 1,
      },
    ],
  };
}

function outputFor(
  ruleId: string,
  assessmentRuleCount: number,
  sourceRef: {
    documentId: string;
    locator: string;
    contentSha256: string;
  },
) {
  const legalRequirements = Array.from(
    { length: assessmentRuleCount },
    (_, index) => ({
      legalRequirementId: `${ruleId}:requirement-${index + 1}`,
      title: `Synthetic requirement ${index + 1}`,
      proposition: `The organization shall satisfy synthetic requirement ${index + 1}.`,
      operativePropositions: [
        {
          actor: "The organization",
          modality: LEGAL_OPERATIVE_MODALITIES.DUTY,
          action: `Satisfy synthetic requirement ${index + 1}`,
          sourceRefs: [sourceRef],
        },
      ],
      applicabilityConditions: ["Applies to the organization"],
      qualifiers: [],
      exceptions: [],
      nonRepositoryDuty: false,
      sourceRefs: [sourceRef],
      coverage: {
        state: LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
        nonAssessableReason: null,
      },
    }),
  );
  return preparationRuleOutputSchema.parse({
    analysis: "Synthetic previously persisted selected-rule output.",
    legalRequirements,
    assessmentRules: legalRequirements.map((requirement, index) => ({
      assessmentRuleId: `${ruleId}:assessment-${index + 1}`,
      legalRequirementIds: [requirement.legalRequirementId],
      concept: `Synthetic control ${index + 1}`,
      criteria: [
        {
          criterionId: `${ruleId}:criterion-${index + 1}`,
          legalRequirementIds: [requirement.legalRequirementId],
        },
      ],
      investigationGoals: ["Inspect the relevant repository evidence."],
      startingNodeTypes: [],
      targetNodeTypes: [],
      edgeStrategies: [],
      graphQueries: [],
      keywords: [],
      commonApis: [],
      commonLibraries: [],
      patterns: [],
      requiredEvidence: ["The relevant repository control."],
      supportingEvidence: [],
      negativeEvidence: [],
      sourceRefs: [sourceRef],
    })),
    contextRelations: [],
  });
}
