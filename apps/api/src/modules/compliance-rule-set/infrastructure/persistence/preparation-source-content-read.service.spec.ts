import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { LEGAL_DOCUMENT_NODE_TYPES } from "@lcsp/contracts/legal-source";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PreparationSourceAnalysisReadService } from "./preparation-source-analysis-read.service.js";

const runId = "31e042e8-6b91-4bfd-8853-108bb4436efd";
const versionId = "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598";
const materializationId = "a".repeat(64);
const sourceNodeId = "b".repeat(64);
const contentFingerprint = "c".repeat(64);

describe("PreparationSourceAnalysisReadService.content", () => {
  let runFindUnique: ReturnType<typeof jest.fn>;
  let frontierFindUnique: ReturnType<typeof jest.fn>;
  let nodeFindUnique: ReturnType<typeof jest.fn>;
  let nodeFindMany: ReturnType<typeof jest.fn>;
  let tx: {
    ruleSetPreparationRun: { findUnique: ReturnType<typeof jest.fn> };
    ruleSetPreparationReviewFrontier: {
      findUnique: ReturnType<typeof jest.fn>;
    };
    legalDocumentNode: {
      findUnique: ReturnType<typeof jest.fn>;
      findMany: ReturnType<typeof jest.fn>;
    };
  };
  let service: PreparationSourceAnalysisReadService;

  beforeEach(() => {
    runFindUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      id: runId,
      legalSourceVersionId: versionId,
    });
    frontierFindUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      preparationRunId: runId,
      inventoryRevision: 3,
      legalSourceVersionId: versionId,
      materializationId,
      revision: 1,
      fingerprint: "frontier",
    });
    nodeFindUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      nodeId: sourceNodeId,
      legalSourceVersionId: versionId,
      materializationId,
      documentId: "document-1",
      nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
      parentNodeId: null,
      structuralPath: "Document/Article 3",
      sourcePath: "source/document-1",
      ordinal: 3,
      label: "3",
      title: "3",
      pageStart: 2,
      pageEnd: 2,
      charStart: 10,
      charEnd: 321,
      content: `${"x".repeat(255)}😀${"y".repeat(100)}`,
      contentFingerprint,
    });
    nodeFindMany = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    tx = {
      ruleSetPreparationRun: { findUnique: runFindUnique },
      ruleSetPreparationReviewFrontier: { findUnique: frontierFindUnique },
      legalDocumentNode: { findUnique: nodeFindUnique, findMany: nodeFindMany },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    };
    service = new PreparationSourceAnalysisReadService(
      prisma as unknown as PrismaService,
    );
  });

  it("returns exact bounded pinned text pages and keeps surrogate pairs intact", async () => {
    const first = await service.content(
      runId,
      sourceNodeId,
      { inventoryRevision: 3, limit: 256 },
      "correlation",
    );
    expect(first).toMatchObject({
      preparationRunId: runId,
      inventoryRevision: 3,
      legalSourceVersionId: versionId,
      materializationId,
      sourceNodeId,
      contentFingerprint,
      offset: 0,
      nextCursor: expect.any(String),
      complete: false,
      structuralPath: "Document/Article 3",
      pageStart: 2,
      charStart: 10,
    });
    expect(first.content).toBe("x".repeat(255));
    expect(nodeFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          nodeId_materializationId: { nodeId: sourceNodeId, materializationId },
        },
      }),
    );

    const cursor = JSON.parse(
      Buffer.from(first.nextCursor!, "base64url").toString("utf8"),
    ) as { offset: number; sourceNodeId: string };
    expect(cursor).toMatchObject({ offset: 255, sourceNodeId });
    const second = await service.content(
      runId,
      sourceNodeId,
      {
        inventoryRevision: 3,
        limit: 256,
        cursor: first.nextCursor!,
      },
      "correlation",
    );
    expect(first.content + second.content).toBe(
      `${"x".repeat(255)}😀${"y".repeat(100)}`,
    );
    expect(second.complete).toBe(true);
    expect(second.nextCursor).toBeNull();
    await expect(
      service.content(
        runId,
        "other-source-node",
        { inventoryRevision: 3, limit: 256, cursor: first.nextCursor! },
        "correlation",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects stale fingerprints and cross-version materialization rows", async () => {
    await expect(
      service.content(
        runId,
        sourceNodeId,
        {
          inventoryRevision: 3,
          limit: 256,
          cursor: Buffer.from(
            JSON.stringify({
              version: 1,
              preparationRunId: runId,
              inventoryRevision: 3,
              legalSourceVersionId: versionId,
              materializationId,
              frontierRevision: 1,
              frontierFingerprint: "frontier",
              sourceNodeId,
              contentFingerprint: "d".repeat(64),
              offset: 256,
            }),
            "utf8",
          ).toString("base64url"),
        },
        "correlation",
      ),
    ).rejects.toMatchObject({ status: 409 });

    nodeFindUnique.mockResolvedValueOnce({
      nodeId: sourceNodeId,
      legalSourceVersionId: "6be8f595-1ae6-44a4-b7c1-ef9d4da37598",
      materializationId,
      documentId: "document-1",
      nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
      parentNodeId: null,
      structuralPath: "Document/Article 3",
      sourcePath: "source/document-1",
      ordinal: 3,
      label: "3",
      title: "3",
      pageStart: null,
      pageEnd: null,
      charStart: null,
      charEnd: null,
      content: "unrelated version",
      contentFingerprint,
    });
    await expect(
      service.content(
        runId,
        sourceNodeId,
        { inventoryRevision: 3, limit: 256 },
        "correlation",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns an explicit empty-content state for an existing pinned node", async () => {
    nodeFindUnique.mockResolvedValueOnce({
      nodeId: sourceNodeId,
      legalSourceVersionId: versionId,
      materializationId,
      documentId: "document-1",
      nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
      parentNodeId: null,
      structuralPath: "Document/Article 3",
      sourcePath: "source/document-1",
      ordinal: 3,
      label: "3",
      title: "3",
      pageStart: null,
      pageEnd: null,
      charStart: null,
      charEnd: null,
      content: "",
      contentFingerprint,
    });
    const result = await service.content(
      runId,
      sourceNodeId,
      { inventoryRevision: 3, limit: 256 },
      "correlation",
    );
    expect(result).toMatchObject({
      availability: "EMPTY",
      content: "",
      contentLength: 0,
      complete: true,
      nextCursor: null,
    });
  });
});
