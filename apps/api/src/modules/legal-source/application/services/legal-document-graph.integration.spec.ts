import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import {
  LEGAL_GRAPH_TRAVERSALS as T,
  LEGAL_DOCUMENT_NODE_TYPES as N,
} from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "./legal-document-graph.service.js";
import { discardDraftDocumentGraphs } from "./discard-draft-document-graph.js";
import type {
  LegalDocumentGraph,
  LegalGraphQuery,
} from "@lcsp/contracts/legal-source";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://unused/unused");
const isolated =
  url.hostname === "127.0.0.1" &&
  url.port === "55441" &&
  url.pathname === "/lcsp_legal_graph";
const database = isolated ? describe : describe.skip;
database("Legal graph derived-index lifecycle on isolated PostgreSQL", () => {
  const prisma = new PrismaService();
  const service = new LegalDocumentGraphService(prisma);
  let versionId: string;
  let graph: LegalDocumentGraph;
  let before: string;
  let otherVersion: string;
  const query = (
    nodeId: string,
    traversal: LegalGraphQuery["traversal"],
    extras = {},
  ) =>
    service.query(versionId, {
      nodeId,
      traversal,
      limit: 20,
      offset: 0,
      ...extras,
    });
  const article = (label: string) =>
    graph.nodes.find((n) => n.nodeType === N.ARTICLE && n.label === label)!;
  beforeAll(async () => {
    await prisma.$connect();
    const tag = randomUUID();
    const version = await prisma.legalSourceVersion.create({
      data: { version: `graph-${tag}`, sourceManifest: {} },
    });
    versionId = version.id;
    otherVersion = (
      await prisma.legalSourceVersion.create({
        data: { version: `other-${tag}`, sourceManifest: {} },
      })
    ).id;
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalSourceVersionId: versionId,
        documentId: "synthetic",
        title: "Synthetic",
        sourceUrl: "https://example.invalid/synthetic",
        sourceSha256: "a".repeat(64),
        sourceEffectStatus: "EFFECTIVE",
        extraction: {
          pages: [
            "Chapter I\nArticle 1. Definitions\n1. A keeper maintains a register.\nArticle 2. Duty\n1. See Article 1(1).\n2. See Article 99.",
          ],
          pageCount: 1,
        },
      },
    });
    await prisma.legalDocumentChunk.createMany({
      data: ["art-1::cl-1", "art-2::cl-1", "art-2::cl-2"].map((locator, i) => ({
        id: `${tag}-${i}`,
        legalSourceVersionId: versionId,
        legalSourceDocumentId: document.id,
        documentId: "synthetic",
        locator,
        content: `retrieval text ${i}`,
        contentSha256: "sha256:" + "a".repeat(64),
        hierarchy: {},
        legalStatus: "ACTIVE",
      })),
    });
    before = JSON.stringify(
      await prisma.legalSourceVersion.findUnique({
        where: { id: versionId },
        include: { documents: true, chunks: true },
      }),
    );
    graph = await service.materialize(versionId);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it("rebuilds idempotently and preserves source content/digests, Rule Sets, Preparations, pins and outbox", async () => {
    const counts = async () =>
      Promise.all([
        prisma.ruleSetPreparationRun.count(),
        prisma.complianceRuleSetVersion.count(),
        prisma.assessmentCase.count(),
        prisma.outboxMessage.count(),
      ]);
    const initial = await counts();
    const repeat = await service.materialize(versionId);
    expect(repeat).toEqual(graph);
    expect(await counts()).toEqual(initial);
    expect(
      await prisma.legalDocumentNode.count({
        where: { materializationId: graph.materializationId },
      }),
    ).toBe(graph.nodes.length);
    expect(
      JSON.stringify(
        await prisma.legalSourceVersion.findUnique({
          where: { id: versionId },
          include: { documents: true, chunks: true },
        }),
      ),
    ).toBe(before);
  });
  it("search returns structural path, node identity and source version", async () => {
    const result = await service.query(versionId, {
      query: "keeper",
      traversal: T.NODE,
      limit: 20,
      offset: 0,
    });
    expect(result).toMatchObject({ legalSourceVersionId: versionId });
    expect("nodes" in result && result.nodes?.[0]).toMatchObject({
      structuralPath: expect.stringContaining("/article/1/paragraph/1"),
      legalSourceVersionId: versionId,
    });
  });
  it("fetches exact node and parent", async () => {
    expect(await query(article("1").nodeId, T.NODE)).toMatchObject({
      node: { nodeId: article("1").nodeId },
    });
    expect(await query(article("1").nodeId, T.PARENT)).toMatchObject({
      nodes: [{ nodeType: N.CHAPTER }],
    });
  });
  it("traverses children, siblings and ancestors using pinned source identity", async () => {
    expect(await query(article("2").nodeId, T.CHILDREN)).toMatchObject({
      total: 2,
    });
    expect(await query(article("1").nodeId, T.SIBLINGS)).toMatchObject({
      nodes: [{ nodeId: article("2").nodeId }],
    });
    expect(await query(article("2").nodeId, T.ANCESTORS)).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ nodeType: N.DOCUMENT }),
      ]),
    });
  });
  it("returns resolved/unresolved references and reverse references", async () => {
    const source = graph.nodes.find((n) =>
      n.content.includes("See Article 1"),
    )!;
    const target = graph.nodes.find((n) => n.content.includes("keeper"))!;
    expect(await query(source.nodeId, T.REFERENCES)).toMatchObject({
      references: [
        expect.objectContaining({
          toNodeId: target.nodeId,
          resolutionState: "RESOLVED",
        }),
      ],
    });
    expect(await query(target.nodeId, T.REFERENCED_BY)).toMatchObject({
      references: [expect.objectContaining({ fromNodeId: source.nodeId })],
    });
    const unresolved = graph.nodes.find((n) =>
      n.content.includes("See Article 99"),
    )!;
    expect(await query(unresolved.nodeId, T.REFERENCES)).toMatchObject({
      references: [
        expect.objectContaining({
          toNodeId: null,
          resolutionState: "UNRESOLVED",
        }),
      ],
    });
  });
  it("bounds context and paginates children", async () => {
    const source = graph.nodes.find((n) =>
      n.content.includes("See Article 1"),
    )!;
    const context = await query(source.nodeId, T.CONTEXT, { limit: 2 });
    expect("nodes" in context && context.nodes?.length).toBeLessThanOrEqual(2);
    expect(
      await query(article("2").nodeId, T.CHILDREN, { limit: 1 }),
    ).toMatchObject({ total: 2, hasMore: true });
  });
  it("maps every chunk to a node and maps nodes back to chunks", async () => {
    expect(graph.chunkMappings).toHaveLength(3);
    const mapping = graph.chunkMappings[0];
    expect(await query(mapping.legalDocumentNodeId, T.CHUNKS)).toMatchObject({
      chunks: [expect.objectContaining({ id: mapping.chunkId })],
    });
  });
  it("cannot traverse a node through another source version", async () => {
    await service.materialize(otherVersion);
    await expect(
      service.query(otherVersion, {
        nodeId: article("1").nodeId,
        traversal: T.NODE,
        limit: 20,
        offset: 0,
      }),
    ).rejects.toThrow();
    expect(
      await prisma.legalDocumentNode.count({
        where: { legalSourceVersionId: otherVersion },
      }),
    ).toBe(0);
  });
  it("enforces same-source node, chunk and reference membership in PostgreSQL", async () => {
    await expect(
      prisma.legalDocumentChunkNode.create({
        data: {
          materializationId: graph.materializationId,
          legalSourceVersionId: otherVersion,
          legalDocumentNodeId: article("1").nodeId,
          chunkId: graph.chunkMappings[0].chunkId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.legalDocumentReference.create({
        data: {
          referenceId: "f".repeat(64),
          materializationId: graph.materializationId,
          legalSourceVersionId: versionId,
          fromNodeId: article("1").nodeId,
          toNodeId: null,
          text: "Article 9",
          charStart: 0,
          charEnd: 9,
          resolutionState: "RESOLVED",
          candidateNodeIds: [],
        },
      }),
    ).rejects.toThrow();
  });
  it("concurrent rebuilds share one deterministic materialization", async () => {
    const results = await Promise.all([
      service.materialize(versionId),
      service.materialize(versionId),
    ]);
    expect(results).toEqual([graph, graph]);
    expect(
      await prisma.legalDocumentMaterialization.count({
        where: { legalSourceVersionId: versionId },
      }),
    ).toBe(1);
    expect(
      await prisma.legalDocumentRetrievalUnit.count({
        where: { legalSourceVersionId: versionId },
      }),
    ).toBe(graph.retrievalUnits.length);
  });
  it("exports real persisted extraction gaps to the pinned graph consumer", async () => {
    const label = randomUUID();
    const source = await prisma.legalSourceVersion.create({
      data: { version: `partial-${label}`, sourceManifest: {} },
    });
    const text = "Article 1. The first page contains extractable text.";
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalSourceVersionId: source.id,
        documentId: "partial-document",
        title: "Partially extractable PDF",
        sourceUrl: "https://example.invalid/partial",
        sourceSha256: "b".repeat(64),
        sourceEffectStatus: "EFFECTIVE",
        extraction: {
          pages: [text, ""],
          pageCount: 2,
          gaps: [{ kind: "NO_TEXT_LAYER", page: 2 }],
        },
      },
    });
    await prisma.legalDocumentChunk.create({
      data: {
        id: `partial-${label}`,
        legalSourceVersionId: source.id,
        legalSourceDocumentId: document.id,
        documentId: document.documentId,
        locator: "p-0001",
        content: text,
        contentSha256: "sha256:" + "b".repeat(64),
        hierarchy: {},
        legalStatus: "ACTIVE",
      },
    });
    const built = await service.materialize(source.id);
    const persisted = await service.export(source.id);
    expect(persisted).toEqual(built);
    expect(persisted?.extractionGaps).toEqual([
      { documentId: document.documentId, kind: "NO_TEXT_LAYER", page: 2 },
    ]);
    expect(built.nodes.some((node) => node.content.includes(text))).toBe(true);
  });
  it("discards a draft index without rewriting source, and rebuilds the same identities", async () => {
    await prisma.$transaction((tx) =>
      discardDraftDocumentGraphs(tx, versionId),
    );
    expect(
      await prisma.legalDocumentMaterialization.count({
        where: { legalSourceVersionId: versionId },
      }),
    ).toBe(0);
    expect(
      JSON.stringify(
        await prisma.legalSourceVersion.findUnique({
          where: { id: versionId },
          include: { documents: true, chunks: true },
        }),
      ),
    ).toBe(before);
    expect(await service.materialize(versionId)).toEqual(graph);
  });
});
