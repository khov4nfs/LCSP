// Invoked on stdin in the isolated API runtime; all writes use existing Legal Source application services.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "./dist/src/infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "./dist/src/platform/audit/audit-writer.service.js";
import { OutboxRepository } from "./dist/src/platform/outbox/outbox.repository.js";
import { LegalSourceService } from "./dist/src/modules/legal-source/application/services/legal-source.service.js";
import { LegalSourceManagementService } from "./dist/src/modules/legal-source/application/services/legal-source-management.service.js";
import { LegalSourceDocumentService } from "./dist/src/modules/legal-source/application/services/legal-source-document.service.js";
import { SafeUrlFetcherService } from "./dist/src/modules/legal-source/application/services/safe-url-fetcher.service.js";
import { structuralIntegrityRef } from "./dist/src/modules/legal-source/application/services/legal-source-structure.js";
import {
  createLegalSourceRequestSchema,
  createLegalSourceVersionRequestSchema,
  uploadLegalSourceDocumentMetadataSchema,
  legalSourceIngestionResultSchema,
  LEGAL_SOURCE_CHUNK_STATUSES,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  LEGAL_SOURCE_INGESTION_OUTCOMES,
} from "@lcsp/contracts/legal-source";

const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
assert(/^[a-f0-9]{16}$/.test(control.runId));
const url = new URL(process.env.DATABASE_URL);
const localInputOnly =
  control.mode === "input" &&
  url.hostname === "127.0.0.1" &&
  url.port === "55446" &&
  url.pathname === "/lcsp_semantic_input_test";
assert(
  localInputOnly ||
    (url.hostname === `lcsp-release-staging-${control.runId}-postgres` &&
      url.pathname === "/lcsp_staging"),
  "Disposable database identity required",
);
assert.deepEqual(
  control.legalSource.provisions.map((p) => p.locator),
  Array.from(
    { length: control.legalSource.provisions.length },
    (_, i) => `SEM-${String(i + 1).padStart(3, "0")}`,
  ),
);
assert([7, 8, 12].includes(control.legalSource.provisions.length));
const prisma = new PrismaService();
const audit = new AuditWriterService(prisma);
const outbox = new OutboxRepository(prisma);
const documents = new LegalSourceDocumentService(
  prisma,
  outbox,
  audit,
  new SafeUrlFetcherService(),
);
const service = new LegalSourceService(prisma, outbox, audit);
const management = new LegalSourceManagementService(
  prisma,
  audit,
  documents,
  service,
);
const actorId = `synthetic-semantic-regression:${control.runId}`;
const correlationId = control.correlationId ?? randomUUID();
try {
  await prisma.$connect();
  assert.equal(
    await prisma.ruleSetPreparationRun.count(),
    0,
    "No Preparation may precede this input gate",
  );
  if (control.mode === "input") {
    assert.equal(
      await prisma.legalSourceVersion.count(),
      0,
      "Fresh isolated source inventory required",
    );
    const source = await management.createSource({
      actorId,
      correlationId,
      request: createLegalSourceRequestSchema.parse({
        name: "Synthetic semantic-stress test instrument",
        slug: `semantic-stress-${control.runId}`,
        description: control.legalSource.provenance,
      }),
    });
    const version = await management.createVersion({
      sourceId: source.id,
      actorId,
      correlationId,
      request: createLegalSourceVersionRequestSchema.parse({}),
    });
    const text = control.legalSource.provisions
      .map((p) => `${p.locator}\n${p.content}`)
      .join("\n\n");
    const metadata = uploadLegalSourceDocumentMetadataSchema.parse({
      fileName: "synthetic-semantic-stress.txt",
      title: control.legalSource.title,
      structureProfile: LEGAL_SOURCE_STRUCTURE_PROFILES.PARAGRAPHS,
      sourceEffectStatus: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
      provisionStatuses: Object.fromEntries(
        control.legalSource.provisions.map((p) => [
          p.locator,
          {
            status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
            sourceRef: control.legalSource.provenance,
          },
        ]),
      ),
    });
    const document = await documents.addUpload({
      versionId: version.id,
      actorId,
      correlationId,
      bytes: Buffer.from(text),
      declaredType: "text/plain",
      metadata,
    });
    const stored = await prisma.legalSourceDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    const result = legalSourceIngestionResultSchema.parse({
      outcome: LEGAL_SOURCE_INGESTION_OUTCOMES.READY,
      attempt: stored.ingestionAttempt,
      extraction: {
        tool: "lcsp360-synthetic-fixture",
        toolVersion: "1",
        structureProfile: LEGAL_SOURCE_STRUCTURE_PROFILES.PARAGRAPHS,
        pageCount: null,
        textSha256: hash(text),
        characterCount: text.length,
      },
      chunks: control.legalSource.provisions.map((p) => ({
        locator: p.locator,
        content: p.content,
        contentSha256: hash(p.content),
        hierarchy: { synthetic: true, semanticStressId: p.locator },
        pageStart: null,
        pageEnd: null,
      })),
    });
    assert.equal(
      (
        await documents.recordIngestionResult({
          documentRowId: document.id,
          result,
          correlationId,
        })
      ).applied,
      true,
    );
    const chunks = await prisma.legalDocumentChunk.findMany({
      where: { legalSourceVersionId: version.id },
      orderBy: { locator: "asc" },
    });
    assert.equal(chunks.length, control.legalSource.provisions.length);
    for (const [index, chunk] of chunks.entries()) {
      assert.equal(
        chunk.locator,
        control.legalSource.provisions[index].locator,
      );
      assert.equal(
        chunk.content,
        control.legalSource.provisions[index].content,
      );
      assert.equal(chunk.contentSha256, hash(chunk.content));
      assert.equal(
        chunk.legalEffectStatus,
        LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
      );
      assert.equal(chunk.legalStatusSourceRef, control.legalSource.provenance);
      assert.equal(chunk.legalSourceVersionId, version.id);
    }
    const detail = await management.getVersion(version.id, correlationId);
    assert.equal(detail.canActivate, true);
    console.log(
      JSON.stringify({
        SEMANTIC_STRESS_INPUT_CONTRACT: "PASS",
        ...(chunks.length >= 8
          ? { ACTOR_FIDELITY_INPUT_CONTRACT: "PASS" }
          : {}),
        ...(chunks.length === 12
          ? { SEMANTIC_CLOSURE_INPUT_CONTRACT: "PASS" }
          : {}),
        sourceId: source.id,
        versionId: version.id,
        version: version.version,
        documentId: stored.documentId,
        documentRowId: document.id,
        correlationId,
        chunks: chunks.length,
        effective: chunks.length,
        unknown: 0,
        provenance: chunks.length,
        hashes: "PASS",
        structuralIntegrity: "PASS",
        preparations: 0,
        sourceManifest:
          "Truthful synthetic test fixture, no official government acquisition claim",
      }),
    );
  } else {
    assert.equal(control.mode, "activate");
    assert(!localInputOnly);
    const index = await prisma.legalRetrievalIndex.findFirstOrThrow({
      where: { legalSourceVersionId: control.versionId },
      orderBy: { validatedAt: "desc" },
    });
    await service.activateValidatedLegalSourceVersion({
      legalSourceVersionId: control.versionId,
      integrityManifestRef: structuralIntegrityRef(index.contentHash),
      retrievalValidationRef: index.validationManifestRef,
      idempotencyKey: `semantic-stress-source:${control.runId}`,
      scopeDescription: control.legalSource.provenance,
      comments: "Synthetic semantic regression only",
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
    }),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
