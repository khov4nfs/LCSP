import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  Prisma,
  PrismaClient,
  type RuleSetPreparationReviewFrontier,
  LegalClaimAccountingRole,
  LegalRequirementCoverageState,
  LegalSemanticClaimState,
  LegalSemanticClaimType,
} from "@prisma/client";
import {
  PREPARATION_CATALOG_KINDS,
  PREPARATION_CATALOG_SOURCES,
  SOURCE_UNIT_DETAIL_AVAILABILITY,
  SOURCE_UNIT_DETAIL_MAPPING_REASONS,
  preparationGeneratedCatalogRequestSchema,
  preparationSourceUnitDetailRequestSchema,
  preparationSourceUnitsRequestSchema,
  type SourceReviewPayload,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_DOCUMENT_NODE_TYPES } from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { seedReferenceDependencies } from "../../../../../test/support/seed-reference-dependencies.js";
import { PreparationSourceAnalysisReadService } from "./preparation-source-analysis-read.service.js";
import { PreparationGeneratedCatalogReadService } from "./preparation-generated-catalog-read.service.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const h3Enabled = process.env.LCSP_R2A_H3_POSTGRES === "1";
const expectedServerAddress =
  process.env.LCSP_R2A_H3_EXPECTED_SERVER_ADDRESS ?? "";
const safeDatabaseTarget = (() => {
  try {
    const url = new URL(databaseUrl);
    const database = url.pathname.replace(/^\//u, "");
    return (
      h3Enabled &&
      expectedServerAddress.length > 0 &&
      url.hostname === "127.0.0.1" &&
      url.port === "55434" &&
      url.username === "postgres" &&
      /^lcsp_r2a_h3_[a-z0-9_]+$/u.test(database)
    );
  } catch {
    return false;
  }
})();
const postgresDescribe = safeDatabaseTarget ? describe : describe.skip;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function request(inventoryRevision = 1, limit = 50, cursor?: string) {
  return preparationSourceUnitsRequestSchema.parse({
    inventoryRevision,
    limit,
    ...(cursor ? { cursor } : {}),
  });
}

function detailRequest(inventoryRevision = 1) {
  return preparationSourceUnitDetailRequestSchema.parse({ inventoryRevision });
}

function catalogRequest(
  kind: (typeof PREPARATION_CATALOG_KINDS)[keyof typeof PREPARATION_CATALOG_KINDS],
  options: {
    inventoryRevision?: number;
    limit?: number;
    search?: string;
    cursor?: string;
  } = {},
) {
  return preparationGeneratedCatalogRequestSchema.parse({
    inventoryRevision: options.inventoryRevision ?? 1,
    kind,
    limit: options.limit ?? 50,
    ...(options.search ? { search: options.search } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
  });
}

function validDraftPayload() {
  return {
    legalRequirements: {
      "req-draft-a": {
        legalRequirementId: "req-draft-a",
        title: "Draft requirement A",
        proposition: "Persisted draft proposition A",
        applicabilityConditions: [],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        sourceRefs: [],
        coverage: {
          state: LegalRequirementCoverageState.NON_ASSESSABLE,
          nonAssessableReason: "External evidence is required",
        },
      },
      "req-draft-b": {
        legalRequirementId: "req-draft-b",
        title: "Draft requirement B",
        proposition: "Persisted draft proposition B",
        applicabilityConditions: [],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        sourceRefs: [],
        coverage: {
          state: LegalRequirementCoverageState.NON_ASSESSABLE,
          nonAssessableReason: "External evidence is required",
        },
      },
    },
    assessmentRules: {
      "rule-draft-a": {
        assessmentRuleId: "rule-draft-a",
        legalRequirementIds: ["req-draft-a"],
        concept: "Draft rule concept",
        criteria: [
          {
            criterionId: "criterion-draft-a",
            legalRequirementIds: ["req-draft-a"],
          },
        ],
        investigationGoals: [],
        startingNodeTypes: [],
        targetNodeTypes: [],
        edgeStrategies: [],
        graphQueries: [],
        keywords: [],
        commonApis: [],
        commonLibraries: [],
        patterns: [],
        requiredEvidence: [],
        supportingEvidence: [],
        negativeEvidence: [],
        sourceRefs: [],
      },
    },
    contextRelations: {},
  };
}

function frontierCoverage(frontier: RuleSetPreparationReviewFrontier) {
  return {
    total: frontier.unitCount,
    pending: frontier.pendingCount,
    inReview: frontier.inReviewCount,
    reviewedWithClaims: frontier.reviewedWithClaimsCount,
    reviewedNoClaims: frontier.reviewedNoClaimsCount,
    blockedReferences: frontier.blockedCount,
    persistedClaims: frontier.persistedClaimCount,
  };
}

postgresDescribe(
  "PreparationSourceAnalysisReadService PostgreSQL integration",
  () => {
    let db: PrismaClient;
    let service: PreparationSourceAnalysisReadService;
    let catalogService: PreparationGeneratedCatalogReadService;

    beforeAll(async () => {
      db = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
      await db.$connect();
      service = new PreparationSourceAnalysisReadService(
        db as unknown as PrismaService,
      );
      catalogService = new PreparationGeneratedCatalogReadService(
        db as unknown as PrismaService,
      );
      const identity = await db.$queryRaw<
        Array<{
          database: string;
          username: string;
          address: string;
          port: number;
        }>
      >(Prisma.sql`
      SELECT current_database() AS database,
             current_user AS username,
             inet_server_addr()::text AS address,
             inet_server_port() AS port
    `);
      expect(identity[0]).toMatchObject({
        database: expect.stringMatching(/^lcsp_r2a_h3_[a-z0-9_]+$/u),
        username: "postgres",
        address: expectedServerAddress,
        port: 5432,
      });
    });

    afterAll(async () => {
      await db?.$disconnect();
    });

    async function seed(unitCount = 4, retained = false) {
      const fixture = await seedReferenceDependencies(
        db,
        unitCount,
        [],
        retained,
      );
      const where = { preparationRunId: fixture.preparationRunId };
      const [frontier, reviews] = await Promise.all([
        db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId: fixture.preparationRunId,
              inventoryRevision: 1,
            },
          },
        }),
        db.ruleSetPreparationSourceReview.findMany({
          where: { ...where, inventoryRevision: 1 },
          orderBy: [{ ordinal: "asc" }, { sourceNodeId: "asc" }],
        }),
      ]);
      return { fixture, frontier, reviews };
    }

    async function seedSubmittedCatalog(
      preparationRunId: string,
      legalSourceVersionId: string,
      materializationId: string,
      sourceNodeId: string,
      claimId: string,
    ) {
      const ruleSetVersionId = randomUUID();
      const requirementRowIds = [randomUUID(), randomUUID()];
      const assessmentRuleRowId = randomUUID();
      const requirements = [
        { id: "req-canonical-a", rowId: requirementRowIds[0] },
        { id: "req-canonical-b", rowId: requirementRowIds[1] },
      ];
      const assessmentContract = {
        assessmentRuleId: "rule-canonical-a",
        legalRequirementIds: ["req-canonical-a"],
        concept: "Persisted canonical concept",
        legalIntent: "Persisted canonical legal intent",
        applicabilityGuidance: "Persisted applicability guidance",
        criteria: [
          {
            criterionId: "criterion-canonical-a",
            legalRequirementIds: ["req-canonical-a"],
            statement: "Canonical linked requirement predicate",
          },
        ],
        investigationGoals: [],
        startingNodeTypes: [],
        targetNodeTypes: [],
        edgeStrategies: [],
        graphQueries: [],
        keywords: [],
        commonApis: [],
        commonLibraries: [],
        patterns: [],
        requiredEvidence: [],
        supportingEvidence: [],
        negativeEvidence: [],
        unresolvedConditions: [],
        sourceRefs: [],
      };

      await db.ruleSetPreparationRun.update({
        where: { id: preparationRunId },
        data: { claimDiscoveryOnly: false },
      });
      await db.complianceRuleSetVersion.create({
        data: {
          id: ruleSetVersionId,
          version: `v3-acceptance-${ruleSetVersionId}`,
          legalSourceVersionId,
          preparationRunId,
          ruleSetDigest: digest(`rule-set-${ruleSetVersionId}`),
        },
      });
      await db.legalSemanticGraph.create({
        data: {
          ruleSetVersionId,
          legalSourceVersionId,
          materializationId,
          contractVersion: "v3-acceptance",
          sourceAccounting: { persisted: true },
          referenceAccounting: [],
          graphDigest: digest(`semantic-graph-${ruleSetVersionId}`),
        },
      });
      await db.legalSemanticClaim.create({
        data: {
          claimId,
          ruleSetVersionId,
          materializationId,
          legalSourceVersionId,
          claimType: LegalSemanticClaimType.DUTY,
          statement: "Persisted source-unit claim",
          state: LegalSemanticClaimState.RELEVANT,
          candidateFingerprint: digest(`claim-${claimId}`),
          ordinal: 0,
        },
      });
      await db.legalSemanticClaimSource.create({
        data: {
          claimId,
          ruleSetVersionId,
          materializationId,
          legalSourceVersionId,
          sourceNodeId,
          ordinal: 0,
        },
      });
      for (const requirement of requirements) {
        await db.legalRequirement.create({
          data: {
            id: requirement.rowId,
            ruleSetVersionId,
            legalRequirementId: requirement.id,
            title: `Persisted ${requirement.id}`,
            proposition: `Persisted proposition for ${requirement.id}`,
            applicabilityConditions: [],
            qualifiers: [],
            exceptions: [],
            nonRepositoryDuty: false,
            coverageState: LegalRequirementCoverageState.NON_ASSESSABLE,
            nonAssessableReason: "Needs external evidence",
            contentDigest: digest(`requirement-${requirement.id}`),
            ordinal: requirement.id.endsWith("a") ? 0 : 1,
          },
        });
      }
      await db.legalRequirementClaimBinding.create({
        data: {
          ruleSetVersionId,
          legalRequirementRowId: requirementRowIds[0],
          claimId,
          role: LegalClaimAccountingRole.OPERATIVE_PROPOSITION,
          index: 0,
          ordinal: 0,
        },
      });
      await db.assessmentRule.create({
        data: {
          id: assessmentRuleRowId,
          ruleSetVersionId,
          assessmentRuleId: "rule-canonical-a",
          assessmentRuleVersion: "1",
          concept: assessmentContract.concept,
          legalIntent: assessmentContract.legalIntent,
          applicabilityGuidance: assessmentContract.applicabilityGuidance,
          criteria: assessmentContract.criteria,
          contract: assessmentContract,
          sourceFingerprint: digest(`rule-source-${ruleSetVersionId}`),
          contentDigest: digest(`rule-content-${ruleSetVersionId}`),
          ordinal: 0,
        },
      });
      await db.assessmentRuleLegalRequirement.create({
        data: {
          ruleSetVersionId,
          assessmentRuleRowId,
          legalRequirementRowId: requirementRowIds[0],
        },
      });
      return { ruleSetVersionId, requirements };
    }

    it("P01 uses persisted frontier coverage independently of filters and page size", async () => {
      const { fixture, frontier, reviews } = await seed(4, true);
      expect(new Set(reviews.map((row) => row.state)).size).toBeGreaterThan(1);

      const result = await service.list(
        fixture.preparationRunId,
        request(1, 1, undefined),
        randomUUID(),
      );

      expect(result.frontier.coverage).toEqual(frontierCoverage(frontier));
      expect(result.frontier.coverage.total).toBe(reviews.length);
      expect(result.units).toHaveLength(1);
      expect(result.hasMore).toBe(true);
    });

    it("P02 projects each persisted Source Review row without inventing fields", async () => {
      const { fixture, frontier, reviews } = await seed(4, true);
      const result = await service.list(
        fixture.preparationRunId,
        request(1, 50),
        randomUUID(),
      );
      const persisted = await db.ruleSetPreparationSourceReview.findMany({
        where: {
          preparationRunId: fixture.preparationRunId,
          inventoryRevision: 1,
        },
        include: { node: true },
        orderBy: [{ ordinal: "asc" }, { sourceNodeId: "asc" }],
      });

      expect(result.units).toHaveLength(reviews.length);
      expect(result.units.map((unit) => unit.sourceNodeId)).toEqual(
        persisted.map((row) => row.sourceNodeId),
      );
      for (const [index, row] of persisted.entries()) {
        expect(result.units[index]).toMatchObject({
          sourceNodeId: row.sourceNodeId,
          legalSourceVersionId: row.legalSourceVersionId,
          materializationId: row.materializationId,
          documentId: row.node.documentId,
          nodeType: row.node.nodeType,
          parentNodeId: row.node.parentNodeId,
          structuralPath: row.structuralPath,
          ordinal: row.ordinal,
          label: row.node.label,
          title: row.node.title,
          state: row.state,
          disposition: row.disposition,
          claimCount: row.ownedClaimCount,
          claimIds: row.claimIds.slice(0, 50),
          referenceCount: row.referenceIds.length,
          blockedReferenceCount: row.blockedReferenceIds.length,
          referencesBlocked: row.blockedReferenceIds.length > 0,
          completedAt: row.completedAt?.toISOString() ?? null,
        });
      }
      expect(result.frontier.coverage).toEqual(frontierCoverage(frontier));
    });

    it("P03 keeps sibling review units separate under one Article node", async () => {
      const { fixture, reviews } = await seed(3);
      const articleType = Object.values(LEGAL_DOCUMENT_NODE_TYPES).find(
        (value) => String(value).includes("ARTICLE"),
      );
      if (!articleType) throw new Error("Article node type is unavailable");
      const exemplar = fixture.documentGraph.nodes[0];
      if (!exemplar) throw new Error("Graph fixture has no node");
      const articleNodeId = `r2a-h3-article-${randomUUID()}`;
      const articlePath = `r2a-h3/${randomUUID()}/article`;

      await db.legalDocumentNode.create({
        data: {
          ...exemplar,
          nodeId: articleNodeId,
          materializationId: fixture.documentGraph.materializationId,
          legalSourceVersionId: fixture.documentGraph.legalSourceVersionId,
          nodeType: articleType,
          parentNodeId: null,
          ordinal: 0,
          label: "Article 99",
          title: "Article 99",
          structuralPath: articlePath,
          sourcePath: articlePath,
          content: "",
          contentFingerprint: digest(articlePath),
        },
      });
      for (const [index, review] of reviews.entries()) {
        const path = `${articlePath}/unit-${index + 1}`;
        await db.legalDocumentNode.update({
          where: {
            nodeId_materializationId: {
              nodeId: review.sourceNodeId,
              materializationId: review.materializationId,
            },
          },
          data: { parentNodeId: articleNodeId, structuralPath: path },
        });
        await db.ruleSetPreparationSourceReview.update({
          where: {
            preparationRunId_inventoryRevision_sourceNodeId: {
              preparationRunId: review.preparationRunId,
              inventoryRevision: review.inventoryRevision,
              sourceNodeId: review.sourceNodeId,
            },
          },
          data: { structuralPath: path },
        });
      }

      const result = await service.list(
        fixture.preparationRunId,
        request(1, 10),
        randomUUID(),
      );
      expect(result.units).toHaveLength(reviews.length);
      expect(new Set(result.units.map((unit) => unit.sourceNodeId)).size).toBe(
        reviews.length,
      );
      expect(
        result.units.every((unit) => unit.parentNodeId === articleNodeId),
      ).toBe(true);
      expect(
        result.units.every(
          (unit) => unit.ancestors.at(-1)?.nodeType === articleType,
        ),
      ).toBe(true);
    });

    it("P04 reads node metadata from the frontier-pinned materialization", async () => {
      const { fixture, frontier, reviews } = await seed(3);
      const sourceNodes = await db.legalDocumentNode.findMany({
        where: {
          materializationId: frontier.materializationId,
          legalSourceVersionId: frontier.legalSourceVersionId,
        },
      });
      const oldTitle = sourceNodes[0]?.title;
      if (!oldTitle) throw new Error("Pinned graph fixture has no titled node");
      const newMaterializationId = digest(
        `new-materialization-${randomUUID()}`,
      );
      const priorMaterialization =
        await db.legalDocumentMaterialization.findUniqueOrThrow({
          where: { id: frontier.materializationId },
        });
      await db.legalDocumentMaterialization.create({
        data: {
          id: newMaterializationId,
          legalSourceVersionId: frontier.legalSourceVersionId,
          parserRevision: `${priorMaterialization.parserRevision}-r2a-h3`,
          materializationRevision: `${priorMaterialization.materializationRevision}-r2a-h3`,
          sourceDigest: digest(`source-${randomUUID()}`),
          graphDigest: digest(`graph-${randomUUID()}`),
          inputModes: priorMaterialization.inputModes as Prisma.InputJsonValue,
        },
      });
      await db.legalDocumentNode.createMany({
        data: sourceNodes.map((node) => ({
          nodeId: node.nodeId,
          materializationId: newMaterializationId,
          legalSourceVersionId: node.legalSourceVersionId,
          documentId: node.documentId,
          nodeType: node.nodeType,
          parentNodeId: node.parentNodeId,
          ordinal: node.ordinal,
          label: node.label,
          title: `newer/${node.title}`,
          structuralPath: node.structuralPath,
          sourcePath: node.sourcePath,
          content: node.content,
          contentFingerprint: node.contentFingerprint,
          legalEffectStatus: node.legalEffectStatus,
          legalStatusSourceRefs:
            node.legalStatusSourceRefs as Prisma.InputJsonValue,
          pageStart: node.pageStart,
          pageEnd: node.pageEnd,
          charStart: node.charStart,
          charEnd: node.charEnd,
        })),
      });

      const result = await service.list(
        fixture.preparationRunId,
        request(1, 50),
        randomUUID(),
      );
      expect(result.materializationId).toBe(frontier.materializationId);
      expect(result.units).toHaveLength(reviews.length);
      expect(result.units.some((unit) => unit.title.startsWith("newer/"))).toBe(
        false,
      );
      expect(result.units.some((unit) => unit.title === oldTitle)).toBe(true);
    });

    it("P05 isolates runs and inventory revisions", async () => {
      const first = await seed(3);
      const otherRun = await seed(2);
      const revisionRows = await db.ruleSetPreparationSourceReview.findMany({
        where: {
          preparationRunId: first.fixture.preparationRunId,
          inventoryRevision: 1,
        },
      });
      await db.$transaction(async (tx) => {
        await tx.ruleSetPreparationReviewFrontier.create({
          data: {
            preparationRunId: first.fixture.preparationRunId,
            inventoryRevision: 2,
            legalSourceVersionId: first.frontier.legalSourceVersionId,
            materializationId: first.frontier.materializationId,
            revision: first.frontier.revision,
            fingerprint: digest(`revision-2-${randomUUID()}`),
            stateFingerprint: digest(`state-2-${randomUUID()}`),
            stateAccumulator: first.frontier.stateAccumulator,
            unitCount: first.frontier.unitCount,
            pendingCount: first.frontier.pendingCount,
            inReviewCount: first.frontier.inReviewCount,
            reviewedWithClaimsCount: first.frontier.reviewedWithClaimsCount,
            reviewedNoClaimsCount: first.frontier.reviewedNoClaimsCount,
            blockedCount: first.frontier.blockedCount,
            persistedClaimCount: first.frontier.persistedClaimCount,
          },
        });
        await tx.ruleSetPreparationSourceReview.createMany({
          data: revisionRows.map((row) => ({
            preparationRunId: row.preparationRunId,
            inventoryRevision: 2,
            materializationId: row.materializationId,
            legalSourceVersionId: row.legalSourceVersionId,
            sourceNodeId: row.sourceNodeId,
            structuralPath: row.structuralPath,
            ordinal: row.ordinal,
            state: row.state,
            disposition: row.disposition,
            reason: row.reason,
            operationId: row.operationId,
            leaseExpiresAt: row.leaseExpiresAt,
            claimIds: row.claimIds,
            ownedClaimCount: row.ownedClaimCount,
            referenceIds: row.referenceIds,
            blockedReferenceIds: row.blockedReferenceIds,
            payload: row.payload as Prisma.InputJsonValue,
            stateFingerprint: row.stateFingerprint,
            completionFingerprint: row.completionFingerprint,
            completedAt: row.completedAt,
          })),
        });
      });

      const revisionOne = await service.list(
        first.fixture.preparationRunId,
        request(1),
        randomUUID(),
      );
      const revisionTwo = await service.list(
        first.fixture.preparationRunId,
        request(2),
        randomUUID(),
      );
      const isolatedRun = await service.list(
        otherRun.fixture.preparationRunId,
        request(1),
        randomUUID(),
      );
      expect(revisionOne.units.map((unit) => unit.sourceNodeId)).toEqual(
        revisionRows.map((row) => row.sourceNodeId),
      );
      expect(revisionTwo.inventoryRevision).toBe(2);
      expect(revisionTwo.units.map((unit) => unit.sourceNodeId)).toEqual(
        revisionRows.map((row) => row.sourceNodeId),
      );
      expect(isolatedRun.preparationRunId).toBe(
        otherRun.fixture.preparationRunId,
      );
      expect(isolatedRun.units.map((unit) => unit.sourceNodeId)).toEqual(
        otherRun.reviews.map((row) => row.sourceNodeId),
      );
      await expect(
        service.list(first.fixture.preparationRunId, request(3), randomUUID()),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("P06 paginates deterministically with ordinal ties and no gaps", async () => {
      const { fixture, reviews } = await seed(10);
      await db.ruleSetPreparationSourceReview.updateMany({
        where: {
          preparationRunId: fixture.preparationRunId,
          inventoryRevision: 1,
        },
        data: { ordinal: 7 },
      });
      const expected = await db.ruleSetPreparationSourceReview.findMany({
        where: {
          preparationRunId: fixture.preparationRunId,
          inventoryRevision: 1,
        },
        orderBy: [{ ordinal: "asc" }, { sourceNodeId: "asc" }],
        select: { sourceNodeId: true },
      });
      const actual: string[] = [];
      let cursor: string | undefined;
      let pageCount = 0;
      do {
        const page = await service.list(
          fixture.preparationRunId,
          request(1, 3, cursor),
          randomUUID(),
        );
        actual.push(...page.units.map((unit) => unit.sourceNodeId));
        expect(page.hasMore).toBe(Boolean(page.nextCursor));
        cursor = page.nextCursor ?? undefined;
        pageCount += 1;
        if (pageCount > 10) throw new Error("Pagination did not terminate");
      } while (cursor);

      expect(reviews).toHaveLength(10);
      expect(pageCount).toBeGreaterThan(1);
      expect(actual).toEqual(expected.map((row) => row.sourceNodeId));
      expect(new Set(actual).size).toBe(reviews.length);
    });

    it("P07 applies state, document and search filters without changing coverage", async () => {
      const { fixture, frontier, reviews } = await seed(6, true);
      const target = reviews[0];
      if (!target) throw new Error("Review fixture has no target row");
      const node = await db.legalDocumentNode.findUniqueOrThrow({
        where: {
          nodeId_materializationId: {
            nodeId: target.sourceNodeId,
            materializationId: target.materializationId,
          },
        },
      });
      const expectedCoverage = frontierCoverage(frontier);
      const stateFiltered = await service.list(
        fixture.preparationRunId,
        preparationSourceUnitsRequestSchema.parse({
          inventoryRevision: 1,
          limit: 50,
          state: target.state,
        }),
        randomUUID(),
      );
      const documentFiltered = await service.list(
        fixture.preparationRunId,
        preparationSourceUnitsRequestSchema.parse({
          inventoryRevision: 1,
          limit: 50,
          documentId: node.documentId,
        }),
        randomUUID(),
      );
      const searchFiltered = await service.list(
        fixture.preparationRunId,
        preparationSourceUnitsRequestSchema.parse({
          inventoryRevision: 1,
          limit: 50,
          search: node.title,
        }),
        randomUUID(),
      );

      expect(
        stateFiltered.units.every((unit) => unit.state === target.state),
      ).toBe(true);
      expect(
        documentFiltered.units.every(
          (unit) => unit.documentId === node.documentId,
        ),
      ).toBe(true);
      expect(
        searchFiltered.units.some(
          (unit) => unit.sourceNodeId === target.sourceNodeId,
        ),
      ).toBe(true);
      for (const result of [stateFiltered, documentFiltered, searchFiltered]) {
        expect(result.frontier.coverage).toEqual(expectedCoverage);
      }
    });

    it("P08 rejects cursors bound to another source version or materialization", async () => {
      const { fixture } = await seed(4);
      const first = await service.list(
        fixture.preparationRunId,
        request(1, 1),
        randomUUID(),
      );
      if (!first.nextCursor) throw new Error("Expected a continuation cursor");
      const cursorPayload = JSON.parse(
        Buffer.from(first.nextCursor, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      const foreignVersionCursor = Buffer.from(
        JSON.stringify({
          ...cursorPayload,
          legalSourceVersionId: randomUUID(),
        }),
      ).toString("base64url");
      const foreignMaterializationCursor = Buffer.from(
        JSON.stringify({
          ...cursorPayload,
          materializationId: digest(randomUUID()),
        }),
      ).toString("base64url");

      await expect(
        service.list(
          fixture.preparationRunId,
          request(1, 1, foreignVersionCursor),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.list(
          fixture.preparationRunId,
          request(1, 1, foreignMaterializationCursor),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("P09 rejects a cursor after the persisted frontier changes", async () => {
      const { fixture, frontier } = await seed(4);
      const first = await service.list(
        fixture.preparationRunId,
        request(1, 1),
        randomUUID(),
      );
      if (!first.nextCursor) throw new Error("Expected a continuation cursor");
      await db.ruleSetPreparationReviewFrontier.update({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: fixture.preparationRunId,
            inventoryRevision: 1,
          },
        },
        data: {
          revision: frontier.revision + 1,
          fingerprint: digest(`changed-${randomUUID()}`),
          stateFingerprint: digest(`changed-state-${randomUUID()}`),
          stateAccumulator: digest(`changed-accumulator-${randomUUID()}`),
        },
      });

      await expect(
        service.list(
          fixture.preparationRunId,
          request(1, 1, first.nextCursor),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("P10 performs real reads without mutating reviews, frontier or graph", async () => {
      const { fixture } = await seed(5);
      const where = {
        preparationRunId: fixture.preparationRunId,
        inventoryRevision: 1,
      };
      const before = {
        frontier: await db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId: fixture.preparationRunId,
              inventoryRevision: 1,
            },
          },
        }),
        reviews: await db.ruleSetPreparationSourceReview.findMany({ where }),
        nodes: await db.legalDocumentNode.findMany({
          where: {
            materializationId: fixture.documentGraph.materializationId,
            legalSourceVersionId: fixture.documentGraph.legalSourceVersionId,
          },
        }),
      };

      await service.list(fixture.preparationRunId, request(1, 2), randomUUID());

      const after = {
        frontier: await db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId: fixture.preparationRunId,
              inventoryRevision: 1,
            },
          },
        }),
        reviews: await db.ruleSetPreparationSourceReview.findMany({ where }),
        nodes: await db.legalDocumentNode.findMany({
          where: {
            materializationId: fixture.documentGraph.materializationId,
            legalSourceVersionId: fixture.documentGraph.legalSourceVersionId,
          },
        }),
      };
      expect(after).toEqual(before);
    });

    it("D01 pins detail reads to the requested run, revision, source and materialization", async () => {
      const selected = await seed(3, true);
      const otherRun = await seed(3);
      const row = selected.reviews.find((review) => review.claimIds.length > 0);
      const foreignRow = otherRun.reviews[0];
      if (!row || !foreignRow)
        throw new Error("Persisted review fixture is missing");

      const materializationsBefore =
        await db.legalDocumentMaterialization.count();
      const detail = await service.detail(
        selected.fixture.preparationRunId,
        row.sourceNodeId,
        detailRequest(1),
        randomUUID(),
      );
      expect(detail).toMatchObject({
        preparationRunId: selected.fixture.preparationRunId,
        inventoryRevision: 1,
        legalSourceVersionId: selected.frontier.legalSourceVersionId,
        materializationId: selected.frontier.materializationId,
        sourceNodeId: row.sourceNodeId,
      });
      expect(detail.legalSourceVersionId).not.toBe(
        otherRun.frontier.legalSourceVersionId,
      );
      await expect(
        service.detail(
          selected.fixture.preparationRunId,
          randomUUID(),
          detailRequest(1),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.detail(
          selected.fixture.preparationRunId,
          row.sourceNodeId,
          detailRequest(2),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const materializationsAfter =
        await db.legalDocumentMaterialization.count();
      expect(materializationsAfter).toBe(materializationsBefore);
      expect(foreignRow.preparationRunId).not.toBe(
        selected.fixture.preparationRunId,
      );
    });

    it("D02 projects bounded persisted output, distinguishes empty output and rejects malformed payloads", async () => {
      const populated = await seed(3, true);
      const review = populated.reviews.find((item) => {
        const itemPayload = item.payload as SourceReviewPayload;
        return (
          item.claimIds.length > 0 && itemPayload.referenceAccounting.length > 0
        );
      });
      if (!review) throw new Error("Claim-bearing persisted review is missing");
      const payload = review.payload as SourceReviewPayload;
      const claim = payload.claims[0];
      const supportedSourceNodeId = claim?.sourceNodeIds[0];
      if (!claim || !supportedSourceNodeId) {
        throw new Error("Persisted claim source-node identity is missing");
      }
      const supportedNode = await db.legalDocumentNode.findUniqueOrThrow({
        where: {
          nodeId_materializationId: {
            nodeId: supportedSourceNodeId,
            materializationId: review.materializationId,
          },
        },
      });
      const payloadWithSupport: SourceReviewPayload = {
        ...payload,
        claims: payload.claims.map((item, index) =>
          index === 0
            ? {
                ...item,
                sourceSupport: [
                  {
                    nodeId: supportedNode.nodeId,
                    startOffset: 0,
                    endOffset: Math.min(1, supportedNode.content.length),
                    contentSha256: supportedNode.contentFingerprint,
                  },
                ],
              }
            : item,
        ),
      };
      await db.ruleSetPreparationSourceReview.update({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            preparationRunId: review.preparationRunId,
            inventoryRevision: review.inventoryRevision,
            sourceNodeId: review.sourceNodeId,
          },
        },
        data: { payload: payloadWithSupport },
      });
      const detail = await service.detail(
        populated.fixture.preparationRunId,
        review.sourceNodeId,
        detailRequest(),
        randomUUID(),
      );
      expect(detail.output.availability).toBe(
        SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE,
      );
      expect(detail.output.claims.length).toBeGreaterThan(0);
      expect(Object.keys(detail.output.identities)).toEqual(
        expect.arrayContaining(
          detail.output.claims.map((claim) => claim.claimId),
        ),
      );
      expect(
        detail.output.claims.some((claim) => claim.sourceSupport.length > 0),
      ).toBe(true);
      expect(detail.output.claims[0]?.sourceSupport.length).toBeGreaterThan(0);
      expect(detail.output.referenceAccounting.length).toBeGreaterThan(0);
      expect(detail.review.claimIds).toEqual(review.claimIds);

      const bounded = await seed(1, true);
      const boundedReview = bounded.reviews.find(
        (item) => item.claimIds.length > 0,
      );
      if (!boundedReview) throw new Error("Bounded review fixture is missing");
      await db.ruleSetPreparationSourceReview.update({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            preparationRunId: boundedReview.preparationRunId,
            inventoryRevision: boundedReview.inventoryRevision,
            sourceNodeId: boundedReview.sourceNodeId,
          },
        },
        data: {
          reason: "R".repeat(1200),
          referenceIds: Array.from(
            { length: 105 },
            (_, index) => `reference-${index}`,
          ),
        },
      });
      const boundedDetail = await service.detail(
        bounded.fixture.preparationRunId,
        boundedReview.sourceNodeId,
        detailRequest(),
        randomUUID(),
      );
      expect(boundedDetail.review.reason).toHaveLength(1000);
      expect(boundedDetail.review.reasonTruncated).toBe(true);
      expect(boundedDetail.review.referenceIds).toHaveLength(100);
      expect(boundedDetail.review.referenceIdsTruncated).toBe(true);

      const empty = await seed(1);
      const emptyReview = empty.reviews[0];
      if (!emptyReview) throw new Error("Empty review fixture is missing");
      const emptyDetail = await service.detail(
        empty.fixture.preparationRunId,
        emptyReview.sourceNodeId,
        detailRequest(),
        randomUUID(),
      );
      expect(emptyDetail.output.availability).toBe(
        SOURCE_UNIT_DETAIL_AVAILABILITY.EMPTY,
      );
      expect(emptyDetail.output.claims).toEqual([]);

      const malformed = await seed(1, true);
      const malformedReview = malformed.reviews[0];
      if (!malformedReview)
        throw new Error("Malformed review fixture is missing");
      await db.ruleSetPreparationSourceReview.update({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            preparationRunId: malformedReview.preparationRunId,
            inventoryRevision: malformedReview.inventoryRevision,
            sourceNodeId: malformedReview.sourceNodeId,
          },
        },
        data: { payload: { malformed: true } },
      });
      await expect(
        service.detail(
          malformed.fixture.preparationRunId,
          malformedReview.sourceNodeId,
          detailRequest(),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 500 });
    });

    it("D03 and D05 use submitted canonical claim, Requirement and Rule links with strict ownership", async () => {
      const selected = await seed(3, true);
      const review = selected.reviews.find((item) => item.claimIds.length > 0);
      if (!review) throw new Error("Submitted mapping needs a persisted claim");
      const claimId = review.claimIds[0];
      if (!claimId) throw new Error("Submitted mapping claim ID is missing");
      const submitted = await seedSubmittedCatalog(
        selected.fixture.preparationRunId,
        selected.frontier.legalSourceVersionId,
        selected.frontier.materializationId,
        review.sourceNodeId,
        claimId,
      );
      await db.ruleSetPreparationAuthoringDraft.create({
        data: {
          preparationRunId: selected.fixture.preparationRunId,
          revision: 1,
          draftVersion: 7,
          draft: validDraftPayload(),
        },
      });

      const detail = await service.detail(
        selected.fixture.preparationRunId,
        review.sourceNodeId,
        detailRequest(),
        randomUUID(),
      );
      expect(detail.provenance.requirementRuleMapping.availability).toBe(
        SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE,
      );
      expect(detail.provenance.requirementRuleMapping.associations).toEqual([
        {
          claimId,
          legalRequirementId: submitted.requirements[0].id,
          assessmentRuleIds: ["rule-canonical-a"],
        },
      ]);

      const requirementFirstPage = await catalogService.list(
        selected.fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, { limit: 1 }),
        randomUUID(),
      );
      expect(requirementFirstPage.source).toBe(
        PREPARATION_CATALOG_SOURCES.SUBMITTED,
      );
      expect(requirementFirstPage.ruleSetVersionId).toBe(
        submitted.ruleSetVersionId,
      );
      expect(requirementFirstPage.total).toBe(2);
      expect(requirementFirstPage.hasMore).toBe(true);
      if (requirementFirstPage.kind !== PREPARATION_CATALOG_KINDS.REQUIREMENT) {
        throw new Error("Submitted Requirement request returned another kind");
      }
      expect(requirementFirstPage.items[0]?.id).not.toBe("req-draft-a");
      const filtered = await catalogService.list(
        selected.fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, {
          search: "req-canonical-a",
        }),
        randomUUID(),
      );
      expect(filtered.total).toBe(2);
      expect(filtered.filteredTotal).toBe(1);
      expect(filtered.items[0]?.id).toBe("req-canonical-a");
      const requirementNextPage = await catalogService.list(
        selected.fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, {
          limit: 1,
          cursor: requirementFirstPage.nextCursor ?? undefined,
        }),
        randomUUID(),
      );
      expect(requirementNextPage.items[0]?.id).not.toBe(
        requirementFirstPage.items[0]?.id,
      );

      const rules = await catalogService.list(
        selected.fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE),
        randomUUID(),
      );
      expect(rules.source).toBe(PREPARATION_CATALOG_SOURCES.SUBMITTED);
      expect(rules.items[0]?.id).toBe("rule-canonical-a");
      if (rules.kind !== PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE) {
        throw new Error(
          "Submitted Assessment Rule request returned another kind",
        );
      }
      expect(rules.items[0]?.data.legalRequirementIds).toEqual([
        "req-canonical-a",
      ]);

      const otherRun = await seed(2, true);
      const otherReview = otherRun.reviews.find(
        (item) => item.claimIds.length > 0,
      );
      if (!otherReview) throw new Error("Cross-run review fixture is missing");
      const otherDetail = await service.detail(
        otherRun.fixture.preparationRunId,
        otherReview.sourceNodeId,
        detailRequest(),
        randomUUID(),
      );
      expect(otherDetail.provenance.requirementRuleMapping).toMatchObject({
        availability: SOURCE_UNIT_DETAIL_AVAILABILITY.UNAVAILABLE,
        unavailableReason:
          SOURCE_UNIT_DETAIL_MAPPING_REASONS.RULE_SET_NOT_SUBMITTED,
        associations: [],
      });

      const mismatchedRun = await seed(1);
      const mismatchedVersionId = randomUUID();
      await db.ruleSetPreparationRun.update({
        where: { id: mismatchedRun.fixture.preparationRunId },
        data: { claimDiscoveryOnly: false },
      });
      await db.complianceRuleSetVersion.create({
        data: {
          id: randomUUID(),
          version: `v3-mismatched-${mismatchedVersionId}`,
          legalSourceVersionId: selected.frontier.legalSourceVersionId,
          preparationRunId: mismatchedRun.fixture.preparationRunId,
          ruleSetDigest: digest(`mismatched-${mismatchedVersionId}`),
        },
      });
      await expect(
        catalogService.list(
          mismatchedRun.fixture.preparationRunId,
          catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("D04 validates exact-revision drafts, search totals, paging and stale draft cursors", async () => {
      const { fixture } = await seed(2);
      await db.ruleSetPreparationAuthoringDraft.create({
        data: {
          preparationRunId: fixture.preparationRunId,
          revision: 1,
          draftVersion: 1,
          draft: validDraftPayload(),
        },
      });
      const first = await catalogService.list(
        fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, { limit: 1 }),
        randomUUID(),
      );
      expect(first.source).toBe(PREPARATION_CATALOG_SOURCES.DRAFT);
      expect(first.total).toBe(2);
      expect(first.hasMore).toBe(true);
      const matching = await catalogService.list(
        fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, {
          search: "req-draft-a",
        }),
        randomUUID(),
      );
      expect(matching.total).toBe(2);
      expect(matching.filteredTotal).toBe(1);
      const second = await catalogService.list(
        fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, {
          limit: 1,
          cursor: first.nextCursor ?? undefined,
        }),
        randomUUID(),
      );
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
      await db.ruleSetPreparationAuthoringDraft.update({
        where: {
          preparationRunId_revision: {
            preparationRunId: fixture.preparationRunId,
            revision: 1,
          },
        },
        data: { draftVersion: 2 },
      });
      await expect(
        catalogService.list(
          fixture.preparationRunId,
          catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, {
            limit: 1,
            cursor: first.nextCursor ?? undefined,
          }),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        catalogService.list(
          fixture.preparationRunId,
          catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT, {
            inventoryRevision: 2,
          }),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });

      const unavailable = await seed(1);
      const unavailablePage = await catalogService.list(
        unavailable.fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT),
        randomUUID(),
      );
      expect(unavailablePage.source).toBe(
        PREPARATION_CATALOG_SOURCES.UNAVAILABLE,
      );
      await db.ruleSetPreparationAuthoringDraft.update({
        where: {
          preparationRunId_revision: {
            preparationRunId: fixture.preparationRunId,
            revision: 1,
          },
        },
        data: {
          draft: {
            legalRequirements: { invalid: { malformed: true } },
            assessmentRules: {},
            contextRelations: {},
          },
        },
      });
      await expect(
        catalogService.list(
          fixture.preparationRunId,
          catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 500 });
    });

    it("D06 leaves persisted preparation, review, graph, draft and submitted state unchanged", async () => {
      const seeded = await seed(2, true);
      const review = seeded.reviews.find((item) => item.claimIds.length > 0);
      if (!review || !review.claimIds[0]) {
        throw new Error("Read-only fixture has no persisted claim");
      }
      await seedSubmittedCatalog(
        seeded.fixture.preparationRunId,
        seeded.frontier.legalSourceVersionId,
        seeded.frontier.materializationId,
        review.sourceNodeId,
        review.claimIds[0],
      );
      await db.ruleSetPreparationAuthoringDraft.create({
        data: {
          preparationRunId: seeded.fixture.preparationRunId,
          revision: 1,
          draftVersion: 1,
          draft: validDraftPayload(),
        },
      });
      const snapshot = async () => ({
        run: await db.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: seeded.fixture.preparationRunId },
        }),
        frontier: await db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId: seeded.fixture.preparationRunId,
              inventoryRevision: 1,
            },
          },
        }),
        reviews: await db.ruleSetPreparationSourceReview.findMany({
          where: {
            preparationRunId: seeded.fixture.preparationRunId,
            inventoryRevision: 1,
          },
          orderBy: { sourceNodeId: "asc" },
        }),
        draft: await db.ruleSetPreparationAuthoringDraft.findUniqueOrThrow({
          where: {
            preparationRunId_revision: {
              preparationRunId: seeded.fixture.preparationRunId,
              revision: 1,
            },
          },
        }),
        ruleSet: await db.complianceRuleSetVersion.findUniqueOrThrow({
          where: { preparationRunId: seeded.fixture.preparationRunId },
        }),
        graphCount: await db.legalDocumentMaterialization.count({
          where: {
            legalSourceVersionId: seeded.frontier.legalSourceVersionId,
          },
        }),
      });
      const before = await snapshot();
      await service.list(
        seeded.fixture.preparationRunId,
        request(1, 2),
        randomUUID(),
      );
      await service.detail(
        seeded.fixture.preparationRunId,
        review.sourceNodeId,
        detailRequest(),
        randomUUID(),
      );
      await catalogService.list(
        seeded.fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.REQUIREMENT),
        randomUUID(),
      );
      await catalogService.list(
        seeded.fixture.preparationRunId,
        catalogRequest(PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE),
        randomUUID(),
      );
      expect(await snapshot()).toEqual(before);
    });
  },
);
