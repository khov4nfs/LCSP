import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { HttpException } from "@nestjs/common";
import { preparationSourceUnitsRequestSchema } from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_DOCUMENT_NODE_TYPES,
  SOURCE_REVIEW_STATES,
} from "@lcsp/contracts/legal-source";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PreparationSourceAnalysisReadService } from "./preparation-source-analysis-read.service.js";

const runId = "31e042e8-6b91-4bfd-8853-108bb4436efd";
const versionId = "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598";
const materializationId = "a".repeat(64);
const nodeId = "b".repeat(64);

describe("PreparationSourceAnalysisReadService", () => {
  let frontier: Record<string, unknown>;
  let tx: {
    ruleSetPreparationRun: { findUnique: ReturnType<typeof jest.fn> };
    ruleSetPreparationReviewFrontier: {
      findUnique: ReturnType<typeof jest.fn>;
    };
    ruleSetPreparationSourceReview: { findMany: ReturnType<typeof jest.fn> };
    legalDocumentNode: { findMany: ReturnType<typeof jest.fn> };
  };
  let transaction: ReturnType<typeof jest.fn>;
  let service: PreparationSourceAnalysisReadService;

  beforeEach(() => {
    frontier = {
      preparationRunId: runId,
      inventoryRevision: 3,
      legalSourceVersionId: versionId,
      materializationId,
      revision: 4,
      fingerprint: "frontier-fingerprint",
      stateFingerprint: "state-fingerprint",
      stateAccumulator: "state-accumulator",
      frozenAt: null,
      unitCount: 9,
      pendingCount: 5,
      inReviewCount: 1,
      reviewedWithClaimsCount: 1,
      reviewedNoClaimsCount: 1,
      blockedCount: 1,
      persistedClaimCount: 3,
    };
    const state = Object.values(SOURCE_REVIEW_STATES)[0];
    const nodeType = Object.values(LEGAL_DOCUMENT_NODE_TYPES)[0];
    const row = (ordinal: number, sourceNodeId: string) => ({
      preparationRunId: runId,
      inventoryRevision: 3,
      legalSourceVersionId: versionId,
      materializationId,
      sourceNodeId,
      structuralPath: `document/section-${ordinal}`,
      ordinal,
      state,
      disposition: null,
      ownedClaimCount: 0,
      claimIds: [],
      referenceIds: [],
      blockedReferenceIds: [],
      completedAt: null,
      node: {
        nodeId: sourceNodeId,
        nodeType,
        parentNodeId: null,
        structuralPath: `document/section-${ordinal}`,
        ordinal,
        label: `Section ${ordinal}`,
        title: `Title ${ordinal}`,
        documentId: "doc-1",
      },
    });
    tx = {
      ruleSetPreparationRun: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: runId,
            legalSourceVersionId: versionId,
          }),
        ),
      },
      ruleSetPreparationReviewFrontier: {
        findUnique: jest.fn(() => Promise.resolve(frontier)),
      },
      ruleSetPreparationSourceReview: {
        findMany: jest.fn((args: unknown) => {
          void args;
          return Promise.resolve([row(1, nodeId), row(2, "c".repeat(64))]);
        }),
      },
      legalDocumentNode: {
        findMany: jest.fn((args: unknown) => {
          void args;
          return Promise.resolve([]);
        }),
      },
    };
    transaction = jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    service = new PreparationSourceAnalysisReadService({
      $transaction: transaction,
    } as unknown as PrismaService);
  });

  it("uses frontier coverage independently of the filtered page and returns a stable cursor", async () => {
    const request = preparationSourceUnitsRequestSchema.parse({
      inventoryRevision: 3,
      limit: 1,
      documentId: "doc-1",
      search: " SECTION ",
    });
    const result = await service.list(runId, request, "correlation");

    expect(result.frontier.coverage).toEqual({
      total: 9,
      pending: 5,
      inReview: 1,
      reviewedWithClaims: 1,
      reviewedNoClaims: 1,
      blockedReferences: 1,
      persistedClaims: 3,
    });
    expect(result.units).toHaveLength(1);
    expect(result.units[0]).toMatchObject({
      sourceNodeId: nodeId,
      claimCount: 0,
    });
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();

    const query = tx.ruleSetPreparationSourceReview.findMany.mock
      .calls[0]?.[0] as {
      where: {
        node: {
          is: {
            AND: Array<Record<string, unknown>>;
          };
        };
      };
    };
    const where = query.where;
    expect(where.node.is.AND).toHaveLength(2);
    expect(where.node.is.AND[0]).toEqual({ documentId: "doc-1" });
    expect(where.node.is.AND[1].OR).toBeDefined();
  });

  it("rejects a cursor reused with different normalized filters", async () => {
    const initial = await service.list(
      runId,
      preparationSourceUnitsRequestSchema.parse({
        inventoryRevision: 3,
        limit: 1,
      }),
      "correlation",
    );
    transaction.mockClear();

    await expect(
      service.list(
        runId,
        preparationSourceUnitsRequestSchema.parse({
          inventoryRevision: 3,
          limit: 1,
          cursor: initial.nextCursor,
          state: Object.values(SOURCE_REVIEW_STATES)[0],
        }),
        "correlation",
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a cursor when the pinned frontier has changed", async () => {
    const initial = await service.list(
      runId,
      preparationSourceUnitsRequestSchema.parse({
        inventoryRevision: 3,
        limit: 1,
      }),
      "correlation",
    );
    frontier = { ...frontier, revision: 5, stateFingerprint: "new-state" };

    await expect(
      service.list(
        runId,
        preparationSourceUnitsRequestSchema.parse({
          inventoryRevision: 3,
          limit: 1,
          cursor: initial.nextCursor,
        }),
        "correlation",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a cursor pinned to a different Legal Source Version", async () => {
    const initial = await service.list(
      runId,
      preparationSourceUnitsRequestSchema.parse({
        inventoryRevision: 3,
        limit: 1,
      }),
      "correlation",
    );
    if (!initial.nextCursor) throw new Error("Expected a continuation cursor");
    const payload = JSON.parse(
      Buffer.from(initial.nextCursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const foreignCursor = Buffer.from(
      JSON.stringify({
        ...payload,
        legalSourceVersionId: "7f4587d5-1053-4a15-9dd9-9791ae5050bb",
      }),
    ).toString("base64url");
    tx.ruleSetPreparationSourceReview.findMany.mockClear();

    await expect(
      service.list(
        runId,
        preparationSourceUnitsRequestSchema.parse({
          inventoryRevision: 3,
          limit: 1,
          cursor: foreignCursor,
        }),
        "correlation",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.ruleSetPreparationSourceReview.findMany).not.toHaveBeenCalled();
  });
});
