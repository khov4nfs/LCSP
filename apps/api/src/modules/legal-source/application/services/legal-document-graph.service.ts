import { Injectable, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  LEGAL_DOCUMENT_GRAPH as REVISION,
  LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES,
  LEGAL_GRAPH_ERROR_CODES as ERRORS,
  LEGAL_GRAPH_TRAVERSALS as T,
  LEGAL_DOCUMENT_NODE_TYPES as N,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  type LegalDocumentGraph,
  type LegalGraphQuery,
} from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  buildLegalDocumentGraph,
  extractionGapsOf,
  legalDocumentIdentifiers,
  legalLocatorSuffix,
} from "../../domain/document-graph.js";

const BATCH_SIZE = 500;
/**
 * Business purpose: Divide derived legal-document graph rows into bounded database insert batches.
 *
 * Business rules:
 * - Batch size is fixed at 500 so materialization writes remain bounded and preserve the input row order.
 * - Empty input produces no batches and therefore no insert operation.
 *
 * Execution flow:
 * 1. Calculate the number of required batches from the row count.
 * 2. Slice the input into consecutive groups of at most 500 rows.
 *
 * Failure cases:
 * - No domain failure is generated; invalid non-array inputs propagate ordinary JavaScript errors.
 *
 * Side effects:
 * - None: rows are copied into slices but are not persisted here.
 */
const batches = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / BATCH_SIZE) }, (_, i) =>
    items.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );
/**
 * Business purpose: Bound legal-document node text before returning it to an agent or API caller.
 *
 * Business rules:
 * - A shared character budget is consumed in input order, and each title is capped at 512 characters.
 * - Truncation is explicit so consumers can distinguish complete source text from bounded context.
 *
 * Execution flow:
 * 1. Slice each node's content to the remaining nonnegative budget.
 * 2. Reduce the budget by returned content length and mark whether that node was truncated.
 *
 * Failure cases:
 * - A negative or exhausted budget yields empty content for later nodes; the helper does not throw for that state.
 *
 * Side effects:
 * - None: the function returns projected node objects and does not mutate the input nodes.
 */
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

  /**
   * Business purpose: Persist the deterministic document graph derived from one immutable legal-source version.
   *
   * Business rules:
   * - A per-version advisory lock and shared row lock prevent competing materializations from using changing source rows.
   * - An existing identical revision is reused; the same materialization identity with a different graph digest is a conflict.
   * - This index lifecycle does not create Rule Sets, Preparation runs, outbox work, or model decisions.
   *
   * Execution flow:
   * 1. Lock the version, load its documents and chunks in stable order, and build the deterministic graph.
   * 2. Reuse a matching materialization or reject a digest conflict for an existing identity.
   * 3. Create the materialization and insert nodes, references, chunk mappings, and retrieval units in bounded batches.
   *
   * Failure cases:
   * - A missing source version raises `sourceNotFound`; conflicting graph content raises `revisionConflict`.
   * - Any database or graph-build failure rolls back the full transaction rather than leaving partial index rows.
   *
   * Side effects:
   * - Creates one derived materialization and its graph rows within a Prisma transaction; no legal-source lifecycle state is changed.
   */
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

  /**
   * Business purpose: Find the newest materialization that matches the platform's currently configured graph revisions.
   *
   * Business rules:
   * - A current graph must match both parser and materialization revision constants for the requested source version.
   * - Older pinned graphs are not returned as current merely because they are the newest stored row.
   *
   * Execution flow:
   * 1. Query materializations for the version and exact configured revisions.
   * 2. Return the newest matching row or null when none exists.
   *
   * Failure cases:
   * - Database errors propagate; absence of a matching revision is represented as null.
   *
   * Side effects:
   * - None beyond a read-only Prisma query.
   */
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

  /**
   * Business purpose: Export a version's derived legal-document graph while preserving any explicit historical materialization pin.
   *
   * Business rules:
   * - A supplied materialization identifier is scoped to the requested LegalSourceVersion and remains readable across parser revisions.
   * - Without a pin, only the currently configured graph revision is selected.
   * - The export carries recorded extraction gaps and reference-only document identity as provenance; it does not repair missing source data.
   *
   * Execution flow:
   * 1. Resolve the pinned materialization or current revision; return null when it does not exist.
   * 2. Load its graph rows and source extraction/corpus metadata.
   * 3. Remove persistence-only columns and return the contract graph shape.
   *
   * Failure cases:
   * - A pin belonging to another version or a missing current materialization returns null; database or mapping errors propagate.
   *
   * Side effects:
   * - None beyond read-only Prisma queries and in-memory projection.
   */
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
          select: { documentId: true, extraction: true, corpusRole: true },
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
      referenceOnlyDocumentIds: sourceDocuments
        .filter(
          (d) =>
            d.corpusRole === LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY,
        )
        .map((d) => d.documentId)
        .sort(),
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

  /**
   * Business purpose: Retrieve bounded structural, reference, chunk, or text context from a Legal Source Version graph.
   *
   * Business rules:
   * - Every query is scoped to the requested source version and one materialization; an explicit materialization pin is never silently replaced.
   * - Document locators resolve structurally and may be RESOLVED, AMBIGUOUS, or UNRESOLVED; the service does not infer legal meaning.
   * - Results are paged and bounded by the graph's node and character context limits.
   *
   * Execution flow:
   * 1. Resolve the pinned or current graph, materializing the current revision only when an unpinned read has none.
   * 2. Apply optional document identity, text, locator, node, and traversal filters within that version and graph.
   * 3. Return the selected rows with pagination, resolution, truncation, and traversal metadata appropriate to the query.
   *
   * Failure cases:
   * - A requested missing graph raises `notMaterialized`; an invalid locator raises `invalid`; a missing node raises `nodeNotFound`.
   * - A pinned graph that is absent is not replaced with a different revision; Prisma and materialization failures propagate.
   *
   * Side effects:
   * - Usually read-only; an unpinned request with no current graph may persist a derived graph through `materialize`.
   */
  async query(legalSourceVersionId: string, query: LegalGraphQuery) {
    let graph = query.materializationId
      ? await this.prisma.legalDocumentMaterialization.findFirst({
          where: { id: query.materializationId, legalSourceVersionId },
        })
      : await this.current(legalSourceVersionId);
    if (!graph && !query.materializationId) {
      await this.materialize(legalSourceVersionId);
      graph = await this.current(legalSourceVersionId);
    }
    if (!graph)
      throw problemException(ERRORS.notMaterialized, "legal-document-graph", {
        status: HttpStatus.CONFLICT,
      });
    const scope = { materializationId: graph.id, legalSourceVersionId };
    const page = {
      take: Math.min(query.limit, REVISION.maxContextNodes),
      skip: query.offset,
    };
    let documentIds: string[] | undefined;
    if (query.documentId) {
      const identity = query.documentId;
      const explicitIds = legalDocumentIdentifiers(identity);
      const cleanIdentity = identity
        .replace(/\s/gu, "")
        .toLocaleUpperCase("vi");
      const documents = await this.prisma.legalSourceDocument.findMany({
        where: {
          legalSourceVersionId,
          OR: [
            { documentId: identity },
            {
              title: { contains: identity, mode: Prisma.QueryMode.insensitive },
            },
            ...explicitIds.map((id) => ({
              title: { contains: id, mode: Prisma.QueryMode.insensitive },
            })),
          ],
        },
        select: { documentId: true, title: true },
      });
      documentIds = documents
        .filter(
          (d) =>
            d.documentId === identity ||
            legalDocumentIdentifiers(d.title).some(
              (id) => id === cleanIdentity || explicitIds.includes(id),
            ),
        )
        .map((d) => d.documentId);
      if (!documentIds.length) {
        documentIds = documents.map((d) => d.documentId);
      }
    }
    const documentScope = documentIds
      ? { documentId: { in: documentIds } }
      : {};
    if (
      query.traversal === T.DOCUMENTS ||
      (query.documentId && !query.nodeId && !query.query)
    ) {
      const suffix = query.locator ? legalLocatorSuffix(query.locator) : null;
      if (query.locator && !suffix)
        throw problemException(ERRORS.invalid, "legal-document-graph", {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      const where = {
        ...scope,
        ...documentScope,
        ...(suffix
          ? { structuralPath: { endsWith: suffix } }
          : {
              nodeType:
                query.nodeType ??
                (query.traversal === T.STRUCTURE ? undefined : N.DOCUMENT),
            }),
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
        nodes: boundedNodes(nodes, suffix ? REVISION.maxContextCharacters : 0),
        total,
        offset: query.offset,
        hasMore: query.offset + nodes.length < total,
        ...(suffix
          ? {
              resolutionState:
                total === 1 ? R.RESOLVED : total ? R.AMBIGUOUS : R.UNRESOLVED,
            }
          : {}),
      };
    }
    if (query.query) {
      const words = [...new Set(query.query.split(/\s+/u))];
      const where = {
        ...scope,
        ...documentScope,
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
      where: { ...scope, ...documentScope, nodeId: query.nodeId },
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
      /**
       * Business purpose: Keep chunk and retrieval-unit text within the remaining context budget for this node query.
       *
       * Business rules:
       * - Input order determines which rows retain text when the shared node budget is exhausted.
       * - Every returned row states whether its source content was truncated.
       *
       * Execution flow:
       * 1. Slice each row's content to the remaining nonnegative character budget.
       * 2. Reduce the captured budget by the returned text length and attach the truncation flag.
       *
       * Failure cases:
       * - An exhausted budget returns empty content for subsequent rows; no business error is raised.
       *
       * Side effects:
       * - Mutates only the query-local remaining character budget; no input row or persisted record is changed.
       */
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
        : query.traversal === T.DESCENDANTS
          ? {
              documentId: node.documentId,
              structuralPath: { startsWith: node.structuralPath + "/" },
            }
          : query.traversal === T.CHILDREN || query.traversal === T.STRUCTURE
            ? { parentNodeId: node.nodeId }
            : {
                parentNodeId: node.parentNodeId,
                nodeId: { not: node.nodeId },
              }),
      ...(query.nodeType ? { nodeType: query.nodeType } : {}),
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
        query.traversal === T.STRUCTURE
          ? 0
          : REVISION.maxContextCharacters - base.node.content.length,
      ),
      total,
      hasMore: query.offset + nodes.length < total,
    };
  }
}
