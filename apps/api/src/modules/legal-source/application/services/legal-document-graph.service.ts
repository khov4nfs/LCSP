import { Injectable, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  LEGAL_DOCUMENT_GRAPH as REVISION,
  LEGAL_GRAPH_ERROR_CODES as ERRORS,
  LEGAL_GRAPH_TRAVERSALS as T,
  type LegalDocumentGraph,
  type LegalGraphQuery,
} from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  buildLegalDocumentGraph,
  extractionGapsOf,
} from "../../domain/document-graph.js";

const BATCH_SIZE = 500;
const batches = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / BATCH_SIZE) }, (_, i) =>
    items.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );
function boundedNodes<T extends { content: string; title: string }>(
  nodes: T[],
  budget: number = REVISION.maxContextCharacters,
) {
  return nodes.map((node) => {
    const content = node.content.slice(0, Math.max(0, budget));
    budget -= content.length;
    return {
      ...node,
      title: node.title.slice(0, 512),
      content,
      truncated: content.length < node.content.length,
    };
  });
}

/** Derived-index lifecycle. Deliberately has no Rule Set, Preparation, outbox or model dependency. */
@Injectable()
export class LegalDocumentGraphService {
  constructor(private readonly prisma: PrismaService) {}

  async materialize(legalSourceVersionId: string): Promise<LegalDocumentGraph> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('lcsp:legal-document-graph'), hashtext(${legalSourceVersionId}))`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "LegalSourceVersion" WHERE id=${legalSourceVersionId} FOR SHARE`,
        );
        const source = await tx.legalSourceVersion.findUnique({
          where: { id: legalSourceVersionId },
          select: {
            documents: {
              orderBy: { documentId: "asc" },
              include: { chunks: { orderBy: { locator: "asc" } } },
            },
          },
        });
        if (!source)
          throw problemException(
            ERRORS.sourceNotFound,
            "legal-document-graph",
            { status: HttpStatus.NOT_FOUND },
          );
        const graph = buildLegalDocumentGraph(
          legalSourceVersionId,
          source.documents,
        );
        const existing = await tx.legalDocumentMaterialization.findUnique({
          where: { id: graph.materializationId },
        });
        if (existing) {
          if (existing.graphDigest !== graph.graphDigest)
            throw problemException(
              ERRORS.revisionConflict,
              "legal-document-graph",
              { status: HttpStatus.CONFLICT },
            );
          return graph;
        }
        await tx.legalDocumentMaterialization.create({
          data: {
            id: graph.materializationId,
            legalSourceVersionId,
            parserRevision: graph.parserRevision,
            materializationRevision: graph.materializationRevision,
            sourceDigest: graph.sourceDigest,
            graphDigest: graph.graphDigest,
            inputModes: graph.inputModes,
          },
        });
        // Parent FKs are deferred by the migration, permitting bounded batch insertion in tree order.
        await tx.$executeRaw(
          Prisma.sql`SET CONSTRAINTS "LegalNode_parent_fkey" DEFERRED`,
        );
        for (const batch of batches(graph.nodes))
          await tx.legalDocumentNode.createMany({
            data: batch.map((node) => ({
              ...node,
              materializationId: graph.materializationId,
            })),
          });
        for (const batch of batches(graph.references))
          await tx.legalDocumentReference.createMany({
            data: batch.map((ref) => ({
              ...ref,
              materializationId: graph.materializationId,
              legalSourceVersionId,
            })),
          });
        for (const batch of batches(graph.chunkMappings))
          await tx.legalDocumentChunkNode.createMany({
            data: batch.map((mapping) => ({
              ...mapping,
              materializationId: graph.materializationId,
              legalSourceVersionId,
            })),
          });
        for (const batch of batches(graph.retrievalUnits))
          await tx.legalDocumentRetrievalUnit.createMany({
            data: batch.map((unit) => ({
              ...unit,
              materializationId: graph.materializationId,
              legalSourceVersionId,
            })),
          });
        return graph;
      },
      { maxWait: 10000, timeout: 120000 },
    );
  }

  async current(legalSourceVersionId: string) {
    return this.prisma.legalDocumentMaterialization.findFirst({
      where: {
        legalSourceVersionId,
        parserRevision: REVISION.parserRevision,
        materializationRevision: REVISION.materializationRevision,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** A pinned materialization stays readable after a parser revision bump; unpinned reads get the current revision. */
  async export(
    legalSourceVersionId: string,
    pinnedMaterializationId?: string,
  ): Promise<LegalDocumentGraph | null> {
    const materialization = pinnedMaterializationId
      ? await this.prisma.legalDocumentMaterialization.findFirst({
          where: { id: pinnedMaterializationId, legalSourceVersionId },
        })
      : await this.current(legalSourceVersionId);
    if (!materialization) return null;
    const where = {
      materializationId: materialization.id,
      legalSourceVersionId,
    };
    const [nodes, references, chunkMappings, retrievalUnits, sourceDocuments] =
      await Promise.all([
        this.prisma.legalDocumentNode.findMany({
          where,
          orderBy: [{ documentId: "asc" }, { structuralPath: "asc" }],
        }),
        this.prisma.legalDocumentReference.findMany({ where }),
        this.prisma.legalDocumentChunkNode.findMany({ where }),
        this.prisma.legalDocumentRetrievalUnit.findMany({
          where,
          orderBy: [{ legalDocumentNodeId: "asc" }, { ordinal: "asc" }],
        }),
        this.prisma.legalSourceDocument.findMany({
          where: { legalSourceVersionId },
          select: { documentId: true, extraction: true },
        }),
      ]);
    return {
      materializationId: materialization.id,
      legalSourceVersionId,
      parserRevision: materialization.parserRevision,
      materializationRevision: materialization.materializationRevision,
      sourceDigest: materialization.sourceDigest,
      graphDigest: materialization.graphDigest,
      inputModes:
        materialization.inputModes as LegalDocumentGraph["inputModes"],
      extractionGaps: extractionGapsOf(sourceDocuments),
      nodes: nodes.map(({ materializationId: _revision, ...node }) => {
        void _revision;
        return {
          ...node,
          legalStatusSourceRefs: node.legalStatusSourceRefs as string[],
        };
      }),
      references: references.map(
        ({
          materializationId: _revision,
          legalSourceVersionId: _version,
          candidateNodeIds,
          ...ref
        }) => {
          void _revision;
          void _version;
          return { ...ref, candidateNodeIds: candidateNodeIds as string[] };
        },
      ),
      chunkMappings: chunkMappings.map(({ chunkId, legalDocumentNodeId }) => ({
        chunkId,
        legalDocumentNodeId,
      })),
      retrievalUnits: retrievalUnits.map(
        ({
          materializationId: _revision,
          legalSourceVersionId: _version,
          ...unit
        }) => {
          void _revision;
          void _version;
          return unit;
        },
      ),
    };
  }

  async query(legalSourceVersionId: string, query: LegalGraphQuery) {
    const graph = await this.current(legalSourceVersionId);
    if (!graph)
      throw problemException(ERRORS.notMaterialized, "legal-document-graph", {
        status: HttpStatus.CONFLICT,
      });
    const scope = { materializationId: graph.id, legalSourceVersionId };
    const page = {
      take: Math.min(query.limit, REVISION.maxContextNodes),
      skip: query.offset,
    };
    if (query.query) {
      const words = [...new Set(query.query.split(/\s+/u))];
      const where = {
        ...scope,
        AND: words.map((word) => ({
          OR: [
            { content: { contains: word, mode: Prisma.QueryMode.insensitive } },
            {
              structuralPath: {
                contains: word,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            { title: { contains: word, mode: Prisma.QueryMode.insensitive } },
          ],
        })),
      };
      const [nodes, total] = await Promise.all([
        this.prisma.legalDocumentNode.findMany({
          where,
          ...page,
          orderBy: [{ documentId: "asc" }, { structuralPath: "asc" }],
        }),
        this.prisma.legalDocumentNode.count({ where }),
      ]);
      return {
        materializationId: graph.id,
        legalSourceVersionId,
        nodes: boundedNodes(nodes),
        total,
        offset: query.offset,
        hasMore: query.offset + nodes.length < total,
      };
    }
    const node = await this.prisma.legalDocumentNode.findFirst({
      where: { ...scope, nodeId: query.nodeId },
    });
    if (!node)
      throw problemException(ERRORS.nodeNotFound, "legal-document-graph", {
        status: HttpStatus.NOT_FOUND,
      });
    const base = {
      materializationId: graph.id,
      legalSourceVersionId,
      node: boundedNodes([node], 2000)[0],
    };
    if (
      query.traversal === T.REFERENCES ||
      query.traversal === T.REFERENCED_BY
    ) {
      const where = {
        ...scope,
        ...(query.traversal === T.REFERENCES
          ? { fromNodeId: node.nodeId }
          : { toNodeId: node.nodeId }),
      };
      const [references, total] = await Promise.all([
        this.prisma.legalDocumentReference.findMany({
          where,
          ...page,
          orderBy: { referenceId: "asc" },
        }),
        this.prisma.legalDocumentReference.count({ where }),
      ]);
      const targets = await this.prisma.legalDocumentNode.findMany({
        where: {
          ...scope,
          nodeId: {
            in: references.flatMap((r) =>
              query.traversal === T.REFERENCED_BY
                ? [r.fromNodeId]
                : r.toNodeId
                  ? [r.toNodeId]
                  : [],
            ),
          },
        },
      });
      return {
        ...base,
        references,
        nodes: boundedNodes(
          targets,
          REVISION.maxContextCharacters - base.node.content.length,
        ),
        total,
        hasMore: query.offset + references.length < total,
      };
    }
    if (query.traversal === T.CHUNKS) {
      const where = { ...scope, legalDocumentNodeId: node.nodeId };
      const [mappings, total] = await Promise.all([
        this.prisma.legalDocumentChunkNode.findMany({
          where,
          ...page,
          include: { chunk: true },
          orderBy: { chunkId: "asc" },
        }),
        this.prisma.legalDocumentChunkNode.count({ where }),
      ]);
      const [units, retrievalUnitCount] = await Promise.all([
        this.prisma.legalDocumentRetrievalUnit.findMany({
          where,
          ...page,
          orderBy: { ordinal: "asc" },
        }),
        this.prisma.legalDocumentRetrievalUnit.count({ where }),
      ]);
      let budget = REVISION.maxContextCharacters - base.node.content.length;
      const trim = <V extends { content: string }>(rows: V[]) =>
        rows.map((row) => {
          const content = row.content.slice(0, Math.max(0, budget));
          budget -= content.length;
          return {
            ...row,
            content,
            truncated: content.length < row.content.length,
          };
        });
      return {
        ...base,
        chunks: trim(mappings.map((m) => m.chunk)),
        retrievalUnits: trim(units),
        retrievalUnitCount,
        total,
        hasMore:
          query.offset + mappings.length < total ||
          query.offset + units.length < retrievalUnitCount,
      };
    }
    if (query.traversal === T.NODE) {
      const offset = query.contentOffset ?? 0;
      const content = node.content.slice(
        offset,
        offset + REVISION.maxContextCharacters,
      );
      return {
        ...base,
        node: { ...node, title: node.title.slice(0, 512), content },
        contentOffset: offset,
        hasMore: offset + content.length < node.content.length,
      };
    }
    if (query.traversal === T.ANCESTORS || query.traversal === T.CONTEXT) {
      const ancestors = await this.prisma.$queryRaw<
        Array<{ nodeId: string; depth: number }>
      >(Prisma.sql`
        WITH RECURSIVE path AS (
          SELECT "nodeId", "parentNodeId", 0 AS depth FROM "LegalDocumentNode"
          WHERE "materializationId"=${graph.id} AND "legalSourceVersionId"=${legalSourceVersionId} AND "nodeId"=${node.nodeId}
          UNION ALL SELECT p."nodeId",p."parentNodeId",path.depth+1 FROM "LegalDocumentNode" p JOIN path ON p."nodeId"=path."parentNodeId"
          WHERE p."materializationId"=${graph.id} AND p."legalSourceVersionId"=${legalSourceVersionId} AND path.depth < ${REVISION.maxContextNodes}
        ) SELECT "nodeId", depth FROM path WHERE depth > 0 ORDER BY depth LIMIT ${page.take}`);
      const ids = ancestors.map((n) => n.nodeId);
      if (query.traversal === T.CONTEXT) {
        const refs = await this.prisma.legalDocumentReference.findMany({
          where: { ...scope, fromNodeId: node.nodeId },
          take: page.take,
        });
        ids.push(
          node.nodeId,
          ...refs.flatMap((r) => (r.toNodeId ? [r.toNodeId] : [])),
        );
      }
      const nodes = await this.prisma.legalDocumentNode.findMany({
        where: {
          ...scope,
          nodeId: { in: [...new Set(ids)].slice(0, page.take) },
        },
      });
      return {
        ...base,
        nodes: boundedNodes(
          nodes,
          REVISION.maxContextCharacters - base.node.content.length,
        ),
        maxCharacters: REVISION.maxContextCharacters,
      };
    }
    const where = {
      ...scope,
      ...(query.traversal === T.PARENT
        ? { nodeId: node.parentNodeId ?? "" }
        : query.traversal === T.CHILDREN
          ? { parentNodeId: node.nodeId }
          : { parentNodeId: node.parentNodeId, nodeId: { not: node.nodeId } }),
    };
    const [nodes, total] = await Promise.all([
      this.prisma.legalDocumentNode.findMany({
        where,
        ...page,
        orderBy: [{ ordinal: "asc" }, { nodeId: "asc" }],
      }),
      this.prisma.legalDocumentNode.count({ where }),
    ]);
    return {
      ...base,
      nodes: boundedNodes(
        nodes,
        REVISION.maxContextCharacters - base.node.content.length,
      ),
      total,
      hasMore: query.offset + nodes.length < total,
    };
  }
}
