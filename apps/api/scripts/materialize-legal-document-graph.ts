import "reflect-metadata";
import "dotenv/config";
import { z } from "zod";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../src/modules/legal-source/application/services/legal-document-graph.service.js";

// Instantiate only the derived-index service: no application bootstrap, consumers or model calls.
const versionId = z.string().uuid().parse(process.argv[2]);
const prisma = new PrismaService();
try {
  await prisma.$connect();
  const graph = await new LegalDocumentGraphService(prisma).materialize(
    versionId,
  );
  const byType: Record<string, number> = {};
  const byDepth: Record<string, number> = {};
  const depths = new Map<string, number>();
  for (const node of graph.nodes) {
    const depth = node.parentNodeId
      ? (depths.get(node.parentNodeId) ?? 0) + 1
      : 0;
    depths.set(node.nodeId, depth);
    byDepth[depth] = (byDepth[depth] ?? 0) + 1;
    byType[node.nodeType] = (byType[node.nodeType] ?? 0) + 1;
  }
  const references: Record<string, number> = {};
  for (const ref of graph.references)
    references[ref.resolutionState] =
      (references[ref.resolutionState] ?? 0) + 1;
  const legacyChunkCount = await prisma.legalDocumentChunk.count({
    where: { legalSourceVersionId: versionId },
  });
  const nodeIds = new Set(graph.nodes.map((n) => n.nodeId));
  const mapped = new Set(
    graph.chunkMappings
      .filter((m) => nodeIds.has(m.legalDocumentNodeId))
      .map((m) => m.chunkId),
  );
  console.log(
    JSON.stringify(
      {
        legalSourceVersionId: versionId,
        materializationId: graph.materializationId,
        parserRevision: graph.parserRevision,
        materializationRevision: graph.materializationRevision,
        sourceDigest: graph.sourceDigest,
        graphDigest: graph.graphDigest,
        inputModes: graph.inputModes,
        documentCount: byType.DOCUMENT ?? 0,
        nodeCount: graph.nodes.length,
        byType,
        byDepth,
        roots: graph.nodes.filter((n) => n.parentNodeId === null).length,
        references,
        legacyChunkCount,
        mappedChunks: mapped.size,
        orphanChunks: legacyChunkCount - mapped.size,
        derivedRetrievalUnitCount: graph.retrievalUnits.length,
        orphanDerivedRetrievalUnits: graph.retrievalUnits.filter(
          (u) => !nodeIds.has(u.legalDocumentNodeId),
        ).length,
        nodesWithPageSpans: graph.nodes.filter((n) => n.pageStart !== null)
          .length,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
