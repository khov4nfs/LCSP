import "reflect-metadata";
import { z } from "zod";
import { LegalDocumentGraphService } from "../src/modules/legal-source/application/services/legal-document-graph.service.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";

/** Rebuilds a DRAFT version's structural materialization (discarded when a document's corpus role changes) and prints its counts. */
const versionId = z.string().uuid().parse(process.argv[2]);
if (!process.env.DATABASE_URL)
  throw new Error("Explicit DATABASE_URL required");
const prisma = new PrismaService();
try {
  const version = await prisma.legalSourceVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  if (version.status !== "DRAFT")
    throw new Error("Only DRAFT versions are rebuilt here");
  const graph = await new LegalDocumentGraphService(prisma).materialize(
    versionId,
  );
  const byDocument: Record<string, number> = {};
  for (const node of graph.nodes)
    byDocument[node.documentId] = (byDocument[node.documentId] ?? 0) + 1;
  console.log(
    JSON.stringify(
      {
        versionId,
        version: version.version,
        materializationId: graph.materializationId,
        nodes: graph.nodes.length,
        references: graph.references.length,
        referenceOnly: graph.referenceOnlyDocumentIds ?? null,
        byDocument,
      },
      null,
      1,
    ),
  );
} finally {
  await prisma.$disconnect();
}
