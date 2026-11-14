import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  Prisma,
  PrismaClient,
  type RuleSetPreparationReviewFrontier,
} from "@prisma/client";
import { preparationSourceUnitsRequestSchema } from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_DOCUMENT_NODE_TYPES } from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { seedReferenceDependencies } from "../../../../../test/support/seed-reference-dependencies.js";
import { PreparationSourceAnalysisReadService } from "./preparation-source-analysis-read.service.js";

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

    beforeAll(async () => {
      db = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
      await db.$connect();
      service = new PreparationSourceAnalysisReadService(
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
          nodeType:
            articleType as (typeof LEGAL_DOCUMENT_NODE_TYPES)[keyof typeof LEGAL_DOCUMENT_NODE_TYPES],
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
  },
);
