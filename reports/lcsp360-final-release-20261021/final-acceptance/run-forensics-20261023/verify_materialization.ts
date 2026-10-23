/** Actual PostgreSQL/production graph service replay, not agentic acceptance. */
import "../../../../apps/api/node_modules/reflect-metadata/Reflect.js";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaService } from "../../../../apps/api/src/infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../apps/api/src/modules/legal-source/application/services/legal-document-graph.service.js";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55507");
assert.equal(url.pathname, "/lcsp360_forensics_20261023");
const snapshot = JSON.parse(readFileSync(new URL("postgres-read-only-snapshot.json", import.meta.url), "utf8"));
const old = snapshot.bundle.documentGraph;
const db = new PrismaService();
try {
  assert.equal(await db.legalSourceVersion.count(), 0);
  await db.legalSourceVersion.create({ data: { id: old.legalSourceVersionId, version: "forensic-full-source-replay", sourceManifest: {} } });
  for (const source of snapshot.bundle.documents) {
    const { chunks, ...document } = source;
    const row = await db.legalSourceDocument.create({ data: { ...document, legalSourceVersionId: old.legalSourceVersionId } });
    await db.legalDocumentChunk.createMany({ data: chunks.map((chunk) => ({ ...chunk, documentId: source.documentId,
      legalSourceVersionId: old.legalSourceVersionId, legalSourceDocumentId: row.id })) });
  }
  await db.legalDocumentMaterialization.create({ data: {
    id: old.materializationId, legalSourceVersionId: old.legalSourceVersionId,
    parserRevision: old.parserRevision, materializationRevision: old.materializationRevision,
    sourceDigest: old.sourceDigest, graphDigest: old.graphDigest, inputModes: old.inputModes,
  } });
  await db.legalDocumentNode.createMany({ data: old.nodes.map((n) => ({ ...n, materializationId: old.materializationId })) });
  await db.legalDocumentReference.createMany({ data: old.references.map((r) => ({ ...r,
    materializationId: old.materializationId, legalSourceVersionId: old.legalSourceVersionId })) });
  await db.legalDocumentChunkNode.createMany({ data: old.chunkMappings.map((m) => ({ ...m,
    materializationId: old.materializationId, legalSourceVersionId: old.legalSourceVersionId })) });
  await db.legalDocumentRetrievalUnit.createMany({ data: old.retrievalUnits.map((u) => ({ ...u,
    materializationId: old.materializationId, legalSourceVersionId: old.legalSourceVersionId })) });
  const service = new LegalDocumentGraphService(db);
  const before = await service.export(old.legalSourceVersionId, old.materializationId);
  const corrected = await service.materialize(old.legalSourceVersionId);
  assert.equal(corrected.parserRevision, "legal-structure-v3");
  assert.equal(corrected.references.length, 8);
  assert.equal((await service.materialize(old.legalSourceVersionId)).materializationId, corrected.materializationId);
  assert.deepEqual(await service.export(old.legalSourceVersionId, old.materializationId), before);
  assert.equal(await db.legalDocumentMaterialization.count(), 2);
  const documents = await db.legalSourceDocument.findMany({ select: { documentId: true, sourceSha256: true } });
  assert.deepEqual(documents, snapshot.bundle.documents.map(({ documentId, sourceSha256 }) => ({ documentId, sourceSha256 })));
  assert.equal(await db.legalDocumentChunk.count(), 15);
  assert.equal(await db.ruleSetPreparationRun.count(), 0);
  assert.equal(await db.complianceRuleSetVersion.count(), 0);
  writeFileSync(new URL("postgres-materialization-replay.json", import.meta.url), JSON.stringify({
    status: "PASS_REAL_POSTGRES_GRAPH_VERSIONING", database: url.pathname.slice(1), port: Number(url.port),
    preservedOldMaterialization: old.materializationId, correctedMaterialization: corrected.materializationId,
    parserRevision: corrected.parserRevision, originalPinnedExportUnchanged: true, idempotentMaterialization: true,
    sourceDocuments: documents, chunks: 15, preparations: 0, ruleSetVersions: 0, providerDispatches: 0,
  }, null, 2) + "\n");
  console.log("PASS actual PostgreSQL: v3 materialization idempotent, v2 pin preserved, no agent run");
} finally { await db.$disconnect(); }
