/** Unfamiliar-source structural counter diagnostic; no claims, verdicts or model calls. */
import "../../../../apps/api/node_modules/reflect-metadata/Reflect.js";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { sourceReviewOperationSchema } from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../apps/api/src/infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../apps/api/src/modules/legal-source/application/services/legal-document-graph.service.js";
import { SourceReviewHandler, StartClaimDiscoveryDiagnosticHandler } from "../../../../apps/api/src/modules/compliance-rule-set/application/commands/source-review/source-review.handler.js";
import { SourceReviewCommand, StartClaimDiscoveryDiagnosticCommand } from "../../../../apps/api/src/modules/compliance-rule-set/application/commands/source-review/source-review.command.js";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55507"); assert.equal(url.pathname, "/lcsp_review_frontier_test");
const source = JSON.parse(readFileSync(process.env.FORENSIC_CONTROL_SOURCE!, "utf8"));
const bytes = readFileSync(new URL("../../../../tests/fixtures/semantic-control/P10-multilingual-unfamiliar.txt", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sourceSha256);
process.env.LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED = "true";
const db = new PrismaService();
try {
  assert.equal(await db.legalSourceVersion.count(), 0);
  const version = await db.legalSourceVersion.create({ data: { version: "unfamiliar-counter-diagnostic", sourceManifest: {} } });
  const document = await db.legalSourceDocument.create({ data: { legalSourceVersionId: version.id,
    documentId: source.documentId, title: source.documentId, sourceUrl: "https://example.invalid/offline-control",
    sourceSha256: `sha256:${source.sourceSha256}`, sourceEffectStatus: "EFFECTIVE" } });
  await db.legalDocumentChunk.createMany({ data: source.chunks.map((c) => ({ ...c, id: randomUUID(), legalSourceVersionId: version.id,
    legalSourceDocumentId: document.id, documentId: document.documentId, legalStatus: "ACTIVE", legalEffectStatus: "EFFECTIVE",
    legalStatusSourceRef: "fixture:unfamiliar-counter-diagnostic" })) });
  const graphs = new LegalDocumentGraphService(db);
  const graph = await graphs.materialize(version.id);
  const started = await new StartClaimDiscoveryDiagnosticHandler(db, graphs).execute(new StartClaimDiscoveryDiagnosticCommand(version.id, randomUUID()));
  assert.equal(started.outcome, "PASSED");
  const runId = started.preparationRunId;
  const handler = new SourceReviewHandler(db, graphs); const operationId = randomUUID();
  for (const action of ["INIT", "NEXT"]) {
    const result = await handler.execute(new SourceReviewCommand(sourceReviewOperationSchema.parse({
      preparationRunId: runId, inventoryRevision: 1, operationId, action,
    }), "unfamiliar-counter-diagnostic"));
    assert.equal(result.outcome, "PASSED");
  }
  const run = await db.ruleSetPreparationRun.findUniqueOrThrow({ where: { id: runId } });
  const frontier = await db.ruleSetPreparationReviewFrontier.findFirstOrThrow({ where: { preparationRunId: runId } });
  const reviews = await db.ruleSetPreparationSourceReview.findMany({ where: { preparationRunId: runId }, orderBy: { ordinal: "asc" } });
  const chunks = await db.legalDocumentChunk.findMany({ where: { legalSourceVersionId: version.id } });
  assert.equal(await db.ruleSetPreparationSemanticAudit.count(), 0); assert.equal(await db.llmUsageEvent.count(), 0);
  writeFileSync(new URL("p10-frontier-counter-snapshot.json", import.meta.url), JSON.stringify({
    run, frontier, reviews, audits: [], providerDispatches: 0, semanticAcceptance: "NOT_EVALUATED",
    sourceFileSha256: source.sourceSha256, bundle: { preparationRunId: runId, legalSourceVersionId: version.id,
      legalSourceVersion: version.version, documentGraph: graph, documents: [{ ...document, chunks }] },
  }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "PASS_UNFAMILIAR_DURABLE_FRONTIER", units: frontier.unitCount,
    nonemptyAstNodes: graph.nodes.filter((n) => n.content.trim()).length, providerDispatches: 0, semanticAudits: 0 }));
} finally { await db.$disconnect(); }
