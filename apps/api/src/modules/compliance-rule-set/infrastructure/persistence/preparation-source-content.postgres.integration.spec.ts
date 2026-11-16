import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  PREPARATION_SOURCE_CONTENT_AVAILABILITY,
  preparationSourceContentRequestSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_DOCUMENT_NODE_TYPES } from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { seedReferenceDependencies } from "../../../../../test/support/seed-reference-dependencies.js";
import { PreparationSourceAnalysisReadService } from "./preparation-source-analysis-read.service.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const expectedDatabase = process.env.LCSP_UXR2A_POSTGRES_DATABASE ?? "";
const expectedServerAddress =
  process.env.LCSP_UXR2A_EXPECTED_SERVER_ADDRESS ?? "";
const safeDatabaseTarget = (() => {
  try {
    const url = new URL(databaseUrl);
    const database = url.pathname.replace(/^\//u, "");
    return (
      process.env.LCSP_UXR2A_POSTGRES === "1" &&
      database === expectedDatabase &&
      /^lcsp_r2a_h3_uxr2a_[a-z0-9_]+$/u.test(database) &&
      url.hostname === "127.0.0.1" &&
      url.port === "55434" &&
      url.username === "postgres"
    );
  } catch {
    return false;
  }
})();
const postgresDescribe = safeDatabaseTarget ? describe : describe.skip;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function request(inventoryRevision = 1, limit = 256, cursor?: string) {
  return preparationSourceContentRequestSchema.parse({
    inventoryRevision,
    limit,
    ...(cursor ? { cursor } : {}),
  });
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

function encodeCursor(cursor: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

postgresDescribe("Preparation source content PostgreSQL acceptance", () => {
  let db: PrismaClient | undefined;
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
             host(inet_server_addr()) AS address,
             inet_server_port() AS port
    `);
    expect(identity[0]).toEqual({
      database: expectedDatabase,
      username: "postgres",
      address: expectedServerAddress,
      port: 5432,
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function seed(unitCount = 2) {
    if (!db) throw new Error("PostgreSQL fixture client is unavailable");
    const fixture = await seedReferenceDependencies(db, unitCount);
    const [frontier, review] = await Promise.all([
      db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: fixture.preparationRunId,
            inventoryRevision: 1,
          },
        },
      }),
      db.ruleSetPreparationSourceReview.findFirstOrThrow({
        where: {
          preparationRunId: fixture.preparationRunId,
          inventoryRevision: 1,
        },
        orderBy: [{ ordinal: "asc" }, { sourceNodeId: "asc" }],
      }),
    ]);
    const node = await db.legalDocumentNode.findUniqueOrThrow({
      where: {
        nodeId_materializationId: {
          nodeId: review.sourceNodeId,
          materializationId: frontier.materializationId,
        },
      },
    });
    return { fixture, frontier, review, node };
  }

  it("P01/P07 reconstructs persisted Unicode text exactly and P10 performs read-only reads", async () => {
    if (!db) throw new Error("PostgreSQL fixture client is unavailable");
    const { fixture, frontier, review, node } = await seed();
    const persistedText = (
      "Điều 3. Tổ chức phải lưu giữ hồ sơ, chứng từ và tài liệu liên quan.\n\n" +
      "Khoản 2. Nghĩa vụ được áp dụng theo quy định của pháp luật. 🙂\n"
    ).repeat(80);
    await db.legalDocumentNode.update({
      where: {
        nodeId_materializationId: {
          nodeId: node.nodeId,
          materializationId: node.materializationId,
        },
      },
      data: {
        content: persistedText,
        contentFingerprint: digest(persistedText),
      },
    });

    const identityWhere = {
      nodeId: node.nodeId,
      materializationId: node.materializationId,
    };
    const before = {
      run: await db.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: fixture.preparationRunId },
        select: { id: true, legalSourceVersionId: true, executionState: true },
      }),
      frontier: await db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: fixture.preparationRunId,
            inventoryRevision: 1,
          },
        },
      }),
      review: await db.ruleSetPreparationSourceReview.findUniqueOrThrow({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            preparationRunId: fixture.preparationRunId,
            inventoryRevision: 1,
            sourceNodeId: review.sourceNodeId,
          },
        },
      }),
      materialization: await db.legalDocumentMaterialization.findUniqueOrThrow({
        where: { id: node.materializationId },
      }),
      node: await db.legalDocumentNode.findUniqueOrThrow({
        where: { nodeId_materializationId: identityWhere },
      }),
    };

    const chunks: string[] = [];
    let cursor: string | undefined;
    let firstPage: Awaited<ReturnType<typeof service.content>> | undefined;
    do {
      const page = await service.content(
        fixture.preparationRunId,
        node.nodeId,
        request(1, 256, cursor),
        randomUUID(),
      );
      firstPage ??= page;
      chunks.push(page.content);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(firstPage).toMatchObject({
      preparationRunId: fixture.preparationRunId,
      inventoryRevision: 1,
      legalSourceVersionId: fixture.documentGraph.legalSourceVersionId,
      materializationId: frontier.materializationId,
      sourceNodeId: review.sourceNodeId,
      contentFingerprint: digest(persistedText),
      availability: PREPARATION_SOURCE_CONTENT_AVAILABILITY.AVAILABLE,
    });
    expect(chunks.join("")).toBe(persistedText);

    const after = {
      run: await db.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: fixture.preparationRunId },
        select: { id: true, legalSourceVersionId: true, executionState: true },
      }),
      frontier: await db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: fixture.preparationRunId,
            inventoryRevision: 1,
          },
        },
      }),
      review: await db.ruleSetPreparationSourceReview.findUniqueOrThrow({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            preparationRunId: fixture.preparationRunId,
            inventoryRevision: 1,
            sourceNodeId: review.sourceNodeId,
          },
        },
      }),
      materialization: await db.legalDocumentMaterialization.findUniqueOrThrow({
        where: { id: node.materializationId },
      }),
      node: await db.legalDocumentNode.findUniqueOrThrow({
        where: { nodeId_materializationId: identityWhere },
      }),
    };
    expect(after).toEqual(before);
  });

  it("P02/P03 rejects cross-run and cross-revision source text", async () => {
    const selected = await seed();
    const other = await seed();
    if (!db) throw new Error("PostgreSQL fixture client is unavailable");
    const selectedText = "selected run legal source text";
    const otherText = "other run legal source text";
    for (const [run, content] of [
      [selected, selectedText],
      [other, otherText],
    ] as const) {
      const node = await db.legalDocumentNode.findUniqueOrThrow({
        where: {
          nodeId_materializationId: {
            nodeId: selected.node.nodeId,
            materializationId: run.frontier.materializationId,
          },
        },
      });
      await db.legalDocumentNode.update({
        where: {
          nodeId_materializationId: {
            nodeId: node.nodeId,
            materializationId: node.materializationId,
          },
        },
        data: { content, contentFingerprint: digest(content) },
      });
    }
    const otherRunResult = await service.content(
      other.fixture.preparationRunId,
      selected.node.nodeId,
      request(1),
      randomUUID(),
    );
    expect(otherRunResult.content).toBe(otherText);
    expect(otherRunResult.content).not.toBe(selectedText);
    const selectedRunResult = await service.content(
      selected.fixture.preparationRunId,
      selected.node.nodeId,
      request(1),
      randomUUID(),
    );
    expect(selectedRunResult.content).toBe(selectedText);
    await expect(
      service.content(
        selected.fixture.preparationRunId,
        selected.node.nodeId,
        request(2),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("P04/P05 reads only the frontier materialization and Legal Source Version", async () => {
    if (!db) throw new Error("PostgreSQL fixture client is unavailable");
    const selected = await seed();
    const other = await seed();
    const materialization =
      await db.legalDocumentMaterialization.findUniqueOrThrow({
        where: { id: selected.frontier.materializationId },
      });
    const alternateMaterializationId = digest(`uxr2a-alt-${randomUUID()}`);
    await db.legalDocumentMaterialization.create({
      data: {
        id: alternateMaterializationId,
        legalSourceVersionId: selected.frontier.legalSourceVersionId,
        parserRevision: `${materialization.parserRevision}-uxr2a`,
        materializationRevision: `${materialization.materializationRevision}-uxr2a`,
        sourceDigest: digest(`source-${randomUUID()}`),
        graphDigest: digest(`graph-${randomUUID()}`),
        inputModes: materialization.inputModes as Prisma.InputJsonValue,
      },
    });
    const selectedNodes = await db.legalDocumentNode.findMany({
      where: {
        materializationId: selected.frontier.materializationId,
        legalSourceVersionId: selected.frontier.legalSourceVersionId,
      },
    });
    await db.legalDocumentNode.createMany({
      data: selectedNodes.map((row) => {
        const content =
          row.nodeId === selected.node.nodeId
            ? "content from a later materialization"
            : row.content;
        return {
          nodeId: row.nodeId,
          materializationId: alternateMaterializationId,
          legalSourceVersionId: selected.frontier.legalSourceVersionId,
          documentId: row.documentId,
          nodeType: row.nodeType,
          parentNodeId: row.parentNodeId,
          ordinal: row.ordinal,
          label: row.label,
          title: row.title,
          structuralPath: row.structuralPath,
          sourcePath: row.sourcePath,
          content,
          contentFingerprint: digest(content),
          legalEffectStatus: row.legalEffectStatus,
          legalStatusSourceRefs:
            row.legalStatusSourceRefs as Prisma.InputJsonValue,
          pageStart: row.pageStart,
          pageEnd: row.pageEnd,
          charStart: row.charStart,
          charEnd: row.charEnd,
        };
      }),
    });

    const foreignMaterializationId = other.frontier.materializationId;
    const foreignNode = await db.legalDocumentNode.findUniqueOrThrow({
      where: {
        nodeId_materializationId: {
          nodeId: selected.node.nodeId,
          materializationId: foreignMaterializationId,
        },
      },
    });
    await db.legalDocumentNode.update({
      where: {
        nodeId_materializationId: {
          nodeId: foreignNode.nodeId,
          materializationId: foreignMaterializationId,
        },
      },
      data: {
        content: "content from another Legal Source Version",
        contentFingerprint: digest("content from another Legal Source Version"),
      },
    });

    const response = await service.content(
      selected.fixture.preparationRunId,
      selected.node.nodeId,
      request(1),
      randomUUID(),
    );
    expect(response.materializationId).toBe(
      selected.frontier.materializationId,
    );
    expect(response.legalSourceVersionId).toBe(
      selected.frontier.legalSourceVersionId,
    );
    expect(response.content).toBe(selected.node.content);
    expect(response.content).not.toContain("later materialization");
    expect(response.content).not.toContain("another Legal Source Version");

    await expect(
      db.legalDocumentNode.update({
        where: {
          nodeId_materializationId: {
            nodeId: selected.node.nodeId,
            materializationId: selected.frontier.materializationId,
          },
        },
        data: { legalSourceVersionId: other.frontier.legalSourceVersionId },
      }),
    ).rejects.toBeDefined();
  });

  it("P06 navigates only persisted ancestors and children without inventing review states", async () => {
    if (!db) throw new Error("PostgreSQL fixture client is unavailable");
    const selected = await seed();
    const parentNodeId = `uxr2a-parent-${randomUUID()}`;
    const parentPath = `/uxr2a/${randomUUID()}/chapter`;
    await db.legalDocumentNode.create({
      data: {
        ...selected.node,
        nodeId: parentNodeId,
        parentNodeId: null,
        nodeType: LEGAL_DOCUMENT_NODE_TYPES.CHAPTER,
        ordinal: 1,
        label: "I",
        title: "Chapter I",
        structuralPath: parentPath,
        sourcePath: parentPath,
        content: "Persisted parent text",
        contentFingerprint: digest("Persisted parent text"),
        legalStatusSourceRefs: selected.node
          .legalStatusSourceRefs as Prisma.InputJsonValue,
      },
    });
    const reviewedPath = `${parentPath}/reviewed-unit`;
    await db.legalDocumentNode.update({
      where: {
        nodeId_materializationId: {
          nodeId: selected.node.nodeId,
          materializationId: selected.frontier.materializationId,
        },
      },
      data: { parentNodeId, structuralPath: reviewedPath },
    });
    const unreviewedNodeId = `uxr2a-unreviewed-${randomUUID()}`;
    const unreviewedPath = `${parentPath}/clause-99`;
    await db.legalDocumentNode.create({
      data: {
        ...selected.node,
        nodeId: unreviewedNodeId,
        parentNodeId,
        nodeType: LEGAL_DOCUMENT_NODE_TYPES.CLAUSE,
        ordinal: 99,
        label: "99",
        title: "99",
        structuralPath: unreviewedPath,
        sourcePath: unreviewedPath,
        content: "Persisted unreviewed clause text",
        contentFingerprint: digest("Persisted unreviewed clause text"),
        legalStatusSourceRefs: selected.node
          .legalStatusSourceRefs as Prisma.InputJsonValue,
      },
    });

    const parent = await service.content(
      selected.fixture.preparationRunId,
      parentNodeId,
      request(1),
      randomUUID(),
    );
    const unreviewed = await service.content(
      selected.fixture.preparationRunId,
      unreviewedNodeId,
      request(1),
      randomUUID(),
    );
    const [reviewedRow, unreviewedRow] = await Promise.all([
      db.ruleSetPreparationSourceReview.findUnique({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            preparationRunId: selected.fixture.preparationRunId,
            inventoryRevision: 1,
            sourceNodeId: selected.node.nodeId,
          },
        },
      }),
      db.ruleSetPreparationSourceReview.findUnique({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            preparationRunId: selected.fixture.preparationRunId,
            inventoryRevision: 1,
            sourceNodeId: unreviewedNodeId,
          },
        },
      }),
    ]);
    expect(parent.children.map((child) => child.sourceNodeId)).toContain(
      unreviewedNodeId,
    );
    expect(
      unreviewed.ancestors.map((ancestor) => ancestor.sourceNodeId),
    ).toContain(parentNodeId);
    expect(reviewedRow).not.toBeNull();
    expect(unreviewedRow).toBeNull();
    expect(
      parent.children.find((child) => child.sourceNodeId === unreviewedNodeId),
    ).not.toHaveProperty("state");
  });

  it("P08/P09 rejects mismatched or stale cursors and represents empty content truthfully", async () => {
    if (!db) throw new Error("PostgreSQL fixture client is unavailable");
    const selected = await seed();
    const longText = "A".repeat(700) + " tiếng Việt 🙂\n".repeat(80);
    await db.legalDocumentNode.update({
      where: {
        nodeId_materializationId: {
          nodeId: selected.node.nodeId,
          materializationId: selected.node.materializationId,
        },
      },
      data: { content: longText, contentFingerprint: digest(longText) },
    });
    const first = await service.content(
      selected.fixture.preparationRunId,
      selected.node.nodeId,
      request(),
      randomUUID(),
    );
    const cursor = first.nextCursor;
    if (!cursor) throw new Error("Expected a bounded continuation cursor");
    const cursorData = decodeCursor(cursor);

    const foreignRun = await seed();
    const sameNodeOnForeignMaterialization =
      await db.legalDocumentNode.findUnique({
        where: {
          nodeId_materializationId: {
            nodeId: selected.node.nodeId,
            materializationId: foreignRun.frontier.materializationId,
          },
        },
      });
    if (!sameNodeOnForeignMaterialization) {
      const foreignBase = foreignRun.fixture.documentGraph.nodes[0];
      if (!foreignBase) throw new Error("Foreign graph fixture is empty");
      await db.legalDocumentNode.create({
        data: {
          ...foreignBase,
          nodeId: selected.node.nodeId,
          materializationId: foreignRun.frontier.materializationId,
          legalSourceVersionId: foreignRun.frontier.legalSourceVersionId,
          parentNodeId: null,
          structuralPath: `/foreign-reused/${randomUUID()}`,
          sourcePath: `/foreign-reused/${randomUUID()}`,
          content: longText,
          contentFingerprint: digest(longText),
        },
      });
    }
    await expect(
      service.content(
        foreignRun.fixture.preparationRunId,
        selected.node.nodeId,
        request(1, 256, cursor),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.content(
        selected.fixture.preparationRunId,
        selected.node.nodeId,
        request(
          1,
          256,
          encodeCursor({ ...cursorData, materializationId: "other" }),
        ),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.content(
        selected.fixture.preparationRunId,
        selected.node.nodeId,
        request(1, 256, "not-a-valid-cursor"),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });

    await db.legalDocumentNode.update({
      where: {
        nodeId_materializationId: {
          nodeId: selected.node.nodeId,
          materializationId: selected.node.materializationId,
        },
      },
      data: {
        content: `${longText}changed`,
        contentFingerprint: digest(`${longText}changed`),
      },
    });
    await expect(
      service.content(
        selected.fixture.preparationRunId,
        selected.node.nodeId,
        request(1, 256, cursor),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(() => request(1, 255)).toThrow();
    await db.legalDocumentNode.update({
      where: {
        nodeId_materializationId: {
          nodeId: selected.node.nodeId,
          materializationId: selected.node.materializationId,
        },
      },
      data: { content: "", contentFingerprint: digest("") },
    });
    await expect(
      service.content(
        selected.fixture.preparationRunId,
        selected.node.nodeId,
        request(),
        randomUUID(),
      ),
    ).resolves.toMatchObject({
      availability: PREPARATION_SOURCE_CONTENT_AVAILABILITY.EMPTY,
      content: "",
      contentLength: 0,
      nextCursor: null,
      complete: true,
    });
  });
});
