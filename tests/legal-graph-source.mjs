// Only the isolated acceptance harness invokes this on stdin in its exact-SHA API image.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "./dist/src/infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "./dist/src/platform/audit/audit-writer.service.js";
import { OutboxRepository } from "./dist/src/platform/outbox/outbox.repository.js";
import { LegalSourceService } from "./dist/src/modules/legal-source/application/services/legal-source.service.js";
import { LegalSourceManagementService } from "./dist/src/modules/legal-source/application/services/legal-source-management.service.js";
import { LegalSourceDocumentService } from "./dist/src/modules/legal-source/application/services/legal-source-document.service.js";
import { LegalDocumentGraphService } from "./dist/src/modules/legal-source/application/services/legal-document-graph.service.js";
import { SafeUrlFetcherService } from "./dist/src/modules/legal-source/application/services/safe-url-fetcher.service.js";
import { structuralIntegrityRef } from "./dist/src/modules/legal-source/application/services/legal-source-structure.js";
import {
  createLegalSourceRequestSchema,
  createLegalSourceVersionRequestSchema,
  uploadLegalSourceDocumentMetadataSchema,
  legalSourceIngestionResultSchema,
  LEGAL_SOURCE_CHUNK_STATUSES as STATUS,
  LEGAL_SOURCE_STRUCTURE_PROFILES as PROFILE,
  LEGAL_DOCUMENT_NODE_TYPES as NODE,
  LEGAL_REFERENCE_RESOLUTION_STATES as REF,
} from "@lcsp/contracts/legal-source";

const url = new URL(process.env.DATABASE_URL);
assert(/^[a-f0-9]{16}$/.test(control.runId));
assert(
  url.hostname === `lcsp-release-staging-${control.runId}-postgres` &&
    url.pathname === "/lcsp_staging",
  "Owned disposable database required",
);
const sha256 = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const prisma = new PrismaService();
const audit = new AuditWriterService(prisma),
  outbox = new OutboxRepository(prisma);
const documents = new LegalSourceDocumentService(
  prisma,
  outbox,
  audit,
  new SafeUrlFetcherService(),
);
const sourceService = new LegalSourceService(prisma, outbox, audit);
const management = new LegalSourceManagementService(
  prisma,
  audit,
  documents,
  sourceService,
);
const graphService = new LegalDocumentGraphService(prisma);
const actorId = `synthetic-legal-graph:${control.runId}`,
  correlationId = control.correlationId ?? randomUUID();

try {
  await prisma.$connect();
  assert.equal(await prisma.ruleSetPreparationRun.count(), 0);
  assert.equal(await prisma.assessmentCase.count(), 0);
  if (control.mode === "input") {
    assert.equal(await prisma.legalSourceVersion.count(), 0);
    const fixture = control.legalSource;
    const bytes = Buffer.from(control.originalBase64, "base64");
    const result = legalSourceIngestionResultSchema.parse(control.ingestion);
    assert.equal(result.outcome, "READY");
    assert.equal(result.extraction.pageCount, 3);
    assert.equal(result.extraction.pages.length, fixture.pages.length);
    for (const [index, page] of result.extraction.pages.entries())
      assert.equal(
        page.split(/\s+/u).filter(Boolean).join(" "),
        fixture.pages[index].split(/\s+/u).filter(Boolean).join(" "),
      );
    const source = await management.createSource({
      actorId,
      correlationId,
      request: createLegalSourceRequestSchema.parse({
        name: fixture.title,
        slug: `legal-graph-${control.runId}`,
        description: fixture.provenance,
      }),
    });
    const version = await management.createVersion({
      sourceId: source.id,
      actorId,
      correlationId,
      request: createLegalSourceVersionRequestSchema.parse({}),
    });
    const document = await documents.addUpload({
      versionId: version.id,
      actorId,
      correlationId,
      bytes,
      declaredType: "application/pdf",
      metadata: uploadLegalSourceDocumentMetadataSchema.parse({
        fileName: "synthetic-legal-graph.pdf",
        title: fixture.title,
        structureProfile: PROFILE.ARTICLES,
        sourceEffectStatus: STATUS.EFFECTIVE,
        provisionStatuses: Object.fromEntries(
          result.chunks.map((c) => [
            c.locator,
            { status: STATUS.EFFECTIVE, sourceRef: fixture.provenance },
          ]),
        ),
      }),
    });
    assert.equal(document.sourceSha256, sha256(bytes));
    assert.equal(
      (
        await documents.recordIngestionResult({
          documentRowId: document.id,
          correlationId,
          result,
        })
      ).applied,
      true,
    );
    const graph = await graphService.materialize(version.id);
    assert.deepEqual(await graphService.materialize(version.id), graph);
    const chunks = await prisma.legalDocumentChunk.findMany({
      where: { legalSourceVersionId: version.id },
    });
    assert.equal(chunks.length, graph.chunkMappings.length);
    assert.equal(
      graph.nodes.filter((n) => n.nodeType === NODE.DOCUMENT).length,
      1,
    );
    assert.equal(
      graph.nodes.filter((n) => n.nodeType === NODE.CHAPTER).length,
      2,
    );
    assert.equal(
      graph.nodes.filter((n) => n.nodeType === NODE.ARTICLE).length,
      8,
    );
    assert(
      graph.nodes.filter((n) => n.nodeType === NODE.PARAGRAPH).length >= 6,
    );
    assert(graph.references.length > 10);
    assert(graph.references.every((r) => r.resolutionState === REF.RESOLVED));
    for (const label of ["2", "4"]) {
      const article = graph.nodes.find(
        (n) => n.nodeType === NODE.ARTICLE && n.label === label,
      );
      assert(
        article.pageEnd > article.pageStart,
        "Real page boundary must preserve Article identity",
      );
    }
    const ids = new Set(graph.nodes.map((n) => n.nodeId));
    assert(
      graph.nodes.every((n) => !n.parentNodeId || ids.has(n.parentNodeId)),
    );
    assert(graph.chunkMappings.every((m) => ids.has(m.legalDocumentNodeId)));
    assert(
      chunks.every(
        (c) =>
          c.legalSourceVersionId === version.id &&
          c.legalEffectStatus === STATUS.EFFECTIVE &&
          c.legalStatusSourceRef === fixture.provenance &&
          c.contentSha256 === sha256(c.content),
      ),
    );
    assert.equal(
      (await management.getVersion(version.id, correlationId)).canActivate,
      true,
    );
    assert.equal(await prisma.ruleSetPreparationRun.count(), 0);
    assert.equal(await prisma.complianceRuleSetVersion.count(), 0);
    console.log(
      JSON.stringify({
        LEGAL_GRAPH_INPUT_CONTRACT: "PASS",
        sourceId: source.id,
        versionId: version.id,
        documentId: document.documentId,
        documentRowId: document.id,
        correlationId,
        chunks: chunks.length,
        astNodes: graph.nodes.length,
        references: graph.references.length,
        resolvedReferences: graph.references.length,
        mappedChunks: graph.chunkMappings.length,
        orphanChunks: 0,
        materializationId: graph.materializationId,
        parserRevision: graph.parserRevision,
        materializationRevision: graph.materializationRevision,
        originalSha256: sha256(bytes),
        preparations: 0,
        ruleSets: 0,
        providerCalls: 0,
        provenance: fixture.provenance,
        graph,
      }),
    );
  } else {
    assert.equal(control.mode, "activate");
    assert(await graphService.current(control.versionId));
    const index = await prisma.legalRetrievalIndex.findFirstOrThrow({
      where: { legalSourceVersionId: control.versionId },
      orderBy: { validatedAt: "desc" },
    });
    await sourceService.activateValidatedLegalSourceVersion({
      legalSourceVersionId: control.versionId,
      integrityManifestRef: structuralIntegrityRef(index.contentHash),
      retrievalValidationRef: index.validationManifestRef,
      idempotencyKey: `legal-graph-source:${control.runId}`,
      scopeDescription: control.legalSource.provenance,
      comments: "One synthetic legal graph architecture acceptance",
      correlationId,
    });
    console.log(
      JSON.stringify({
        activated: true,
        versionId: control.versionId,
        correlationId,
      }),
    );
  }
} catch (error) {
  console.error(
    JSON.stringify({
      errorType: error.constructor.name,
      code: error.response?.problem?.code ?? null,
      detail:
        error instanceof assert.AssertionError ? error.message : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
