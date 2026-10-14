import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  LEGAL_EFFECT_STATUSES,
  LEGAL_SOURCE_CHUNK_STATUSES,
  LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
  LEGAL_SOURCE_INGESTION_OUTCOMES,
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES as States,
  LEGAL_SOURCE_DOCUMENT_ORIGINS as Origins,
  LEGAL_SOURCE_LIFECYCLE_STATUSES as Lifecycle,
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  LEGAL_SOURCE_STRUCTURAL_INDEX,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  type LegalEffectStatus,
  type ImportLegalSourceDocumentRequest,
  type LegalSourceChunkPage,
  type LegalSourceChunkQuery,
  type LegalSourceDocumentView,
  type LegalSourceIngestionResult,
  type UploadLegalSourceDocumentMetadata,
} from "@lcsp/contracts/legal-source";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { LegalRetrievalIndexStatus, Prisma } from "@prisma/client";

import {
  toPrismaLegalSourceDocumentIngestionState,
  toPrismaLegalSourceDocumentOrigin,
  toPrismaLegalSourceLifecycleStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  cleanFileName,
  detectMediaType,
  documentIdFrom,
} from "./document-media-type.js";
import {
  managedChunkId,
  sha256Ref,
  STRUCTURAL_CONFIG_HASH,
  structuralIndexVersion,
  structuralValidationRef,
  validateStructure,
} from "./legal-source-structure.js";
import { toDocumentView } from "./legal-source-views.js";
import {
  ImportRejectedError,
  SafeUrlFetcherService,
  type FetchedDocument,
} from "./safe-url-fetcher.service.js";

const NOT_STATED = "NOT_STATED";
const MAX_CHUNK_CONTENT = 200_000;
const PERSISTED_CHUNK_BATCH = 500;

type Tx = Prisma.TransactionClient;
interface LockedVersion {
  id: string;
  status: string;
  version: string;
}

interface NewDocument {
  versionId: string;
  actorId: string;
  correlationId: string;
  bytes: Buffer;
  fileName: string;
  declaredType: string | null;
  origin: typeof Origins.UPLOAD | typeof Origins.URL_IMPORT;
  sourceUrl: string;
  provenance: Prisma.InputJsonObject;
  title?: string;
  structureProfile: string;
  sourceEffectStatus?: string;
  effectiveDate?: string;
}

/**
 * Documents of a Legal Source Version: adding (upload or URL import), the ingestion hand-off to
 * the runtime, the runtime's result, and the structural validation that makes a version
 * activatable. Original bytes are stored once, content-addressed and immutable; only a DRAFT
 * version ever changes.
 */
@Injectable()
export class LegalSourceDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly audit: AuditWriterService,
    private readonly fetcher: SafeUrlFetcherService,
  ) {}

  async addUpload(input: {
    versionId: string;
    actorId: string;
    correlationId: string;
    bytes: Buffer;
    declaredType: string | null;
    metadata: UploadLegalSourceDocumentMetadata;
  }): Promise<LegalSourceDocumentView> {
    const fileName = cleanFileName(input.metadata.fileName);
    return this.addDocument({
      versionId: input.versionId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      bytes: input.bytes,
      fileName,
      declaredType: input.declaredType,
      origin: Origins.UPLOAD,
      sourceUrl: `upload://${encodeURIComponent(fileName)}`,
      provenance: {
        uploadedFileName: fileName,
        provisionStatuses: input.metadata.provisionStatuses ?? {},
      },
      title: input.metadata.title,
      structureProfile: input.metadata.structureProfile,
      sourceEffectStatus: input.metadata.sourceEffectStatus,
      effectiveDate: input.metadata.effectiveDate,
    });
  }

  /**
   * Imports one public document. The bytes are fetched once, hashed and stored as a snapshot; the
   * version never depends on the live URL again.
   */
  async importFromUrl(input: {
    versionId: string;
    actorId: string;
    correlationId: string;
    request: ImportLegalSourceDocumentRequest;
  }): Promise<LegalSourceDocumentView> {
    await this.requireDraft(input.versionId, input.correlationId);
    let fetched: FetchedDocument;
    try {
      fetched = await this.fetcher.fetch(input.request.url);
    } catch (error) {
      if (error instanceof ImportRejectedError) {
        throw problemException(Errors.importUrlRejected, input.correlationId, {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { reason: error.reason },
        });
      }
      throw error;
    }
    return this.addDocument({
      versionId: input.versionId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      bytes: fetched.bytes,
      fileName: cleanFileName(fetched.fileName ?? "imported-document"),
      declaredType: fetched.contentType,
      origin: Origins.URL_IMPORT,
      sourceUrl: fetched.finalUrl,
      provenance: {
        requestedUrl: fetched.requestedUrl,
        finalUrl: fetched.finalUrl,
        retrievedAt: fetched.retrievedAt.toISOString(),
        httpStatus: fetched.status,
        redirects: fetched.redirects,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        declaredContentType: fetched.contentType,
        provisionStatuses: input.request.provisionStatuses ?? {},
      },
      title: input.request.title,
      structureProfile: input.request.structureProfile,
      sourceEffectStatus: input.request.sourceEffectStatus,
      effectiveDate: input.request.effectiveDate,
    });
  }

  async retry(input: {
    versionId: string;
    documentRowId: string;
    actorId: string;
    correlationId: string;
  }): Promise<LegalSourceDocumentView> {
    return this.prisma.$transaction(async (tx) => {
      const version = await this.lockDraft(
        tx,
        input.versionId,
        input.correlationId,
      );
      const document = await this.findDocument(
        tx,
        input.versionId,
        input.documentRowId,
        input.correlationId,
      );
      if (
        document.ingestionState ===
        toPrismaLegalSourceDocumentIngestionState(States.READY)
      ) {
        throw problemException(
          Errors.documentNotRetryable,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      if (!document.blobSha256 || !document.mediaType) {
        throw problemException(
          Errors.documentNotRetryable,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      const attempt = document.ingestionAttempt + 1;
      await tx.legalDocumentChunk.deleteMany({
        where: { legalSourceDocumentId: document.id },
      });
      await tx.legalSourceDocument.update({
        where: { id: document.id },
        data: {
          ingestionState: toPrismaLegalSourceDocumentIngestionState(
            States.PENDING,
          ),
          ingestionFailureCode: null,
          ingestionAttempt: attempt,
          extraction: Prisma.DbNull,
          ingestedAt: null,
        },
      });
      await this.dropStructuralIndex(tx, version);
      await this.enqueueIngestion(tx, {
        version,
        document,
        attempt,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      await this.record(
        tx,
        "LEGAL_SOURCE_DOCUMENT_RETRIED",
        input,
        version.id,
        {
          documentRowId: document.id,
          documentId: document.documentId,
          attempt,
        },
      );
      return this.view(tx, document.id, true);
    });
  }

  async remove(input: {
    versionId: string;
    documentRowId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.lockDraft(
        tx,
        input.versionId,
        input.correlationId,
      );
      const document = await this.findDocument(
        tx,
        input.versionId,
        input.documentRowId,
        input.correlationId,
      );
      await tx.legalSourceDocument.delete({ where: { id: document.id } });
      await this.dropStructuralIndex(tx, version);
      await this.deleteOrphanBlobs(tx, document.blobSha256);
      await this.record(
        tx,
        "LEGAL_SOURCE_DOCUMENT_REMOVED",
        input,
        version.id,
        {
          documentRowId: document.id,
          documentId: document.documentId,
          sourceSha256: document.sourceSha256,
        },
      );
    });
  }

  async readOriginal(
    documentRowId: string,
    scope: { versionId?: string; activeOnly?: boolean },
    correlationId: string,
  ): Promise<{
    bytes: Buffer;
    mediaType: string;
    fileName: string;
    sha256: string;
  }> {
    const document = await this.prisma.legalSourceDocument.findFirst({
      where: {
        id: documentRowId,
        ...(scope.versionId ? { legalSourceVersionId: scope.versionId } : {}),
        ...(scope.activeOnly
          ? {
              legalSourceVersion: {
                status: toPrismaLegalSourceLifecycleStatus(Lifecycle.active),
              },
            }
          : {}),
      },
      include: { blob: true },
    });
    if (!document?.blob || !document.mediaType) {
      throw problemException(Errors.documentNotFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    return {
      bytes: Buffer.from(document.blob.bytes),
      mediaType: document.mediaType,
      fileName: document.originalFileName ?? `${document.documentId}`,
      sha256: document.blob.sha256,
    };
  }

  async listChunks(input: {
    documentRowId: string;
    versionId?: string;
    activeOnly?: boolean;
    query: LegalSourceChunkQuery;
    correlationId: string;
  }): Promise<LegalSourceChunkPage> {
    const document = await this.prisma.legalSourceDocument.findFirst({
      where: {
        id: input.documentRowId,
        ...(input.versionId ? { legalSourceVersionId: input.versionId } : {}),
        ...(input.activeOnly
          ? {
              legalSourceVersion: {
                status: toPrismaLegalSourceLifecycleStatus(Lifecycle.active),
              },
            }
          : {}),
      },
      select: { id: true },
    });
    if (!document) {
      throw problemException(Errors.documentNotFound, input.correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    const where = { legalSourceDocumentId: document.id };
    const [total, rows] = await Promise.all([
      this.prisma.legalDocumentChunk.count({ where }),
      this.prisma.legalDocumentChunk.findMany({
        where,
        orderBy: [{ pageStart: "asc" }, { id: "asc" }],
        skip: (input.query.page - 1) * input.query.pageSize,
        take: input.query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        locator: row.locator,
        content: row.content,
        contentSha256: row.contentSha256,
        hierarchy: (row.hierarchy ?? {}) as Record<string, unknown>,
        legalEffectStatus: row.legalEffectStatus,
        legalStatusSourceRef: row.legalStatusSourceRef,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
      })),
      total,
      page: input.query.page,
      pageSize: input.query.pageSize,
    };
  }

  /** Runtime picks up a document: returns what to extract and marks the attempt as running. */
  async beginIngestion(input: {
    documentRowId: string;
    attempt: number;
    correlationId: string;
  }): Promise<{
    bytes: Buffer;
    mediaType: string;
    structureProfile: string;
    sha256: string;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.legalSourceDocument.findUnique({
        where: { id: input.documentRowId },
        include: { blob: true },
      });
      if (!document?.blob || !document.mediaType) {
        throw problemException(Errors.documentNotFound, input.correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }
      const version = await this.lockVersion(
        tx,
        document.legalSourceVersionId,
        input.correlationId,
      );
      if (
        version.status !== Lifecycle.draft ||
        document.ingestionAttempt !== input.attempt
      ) {
        throw problemException(
          Errors.documentNotRetryable,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      if (
        document.ingestionState ===
        toPrismaLegalSourceDocumentIngestionState(States.PENDING)
      ) {
        await tx.legalSourceDocument.update({
          where: { id: document.id },
          data: {
            ingestionState: toPrismaLegalSourceDocumentIngestionState(
              States.PROCESSING,
            ),
          },
        });
      }
      return {
        bytes: Buffer.from(document.blob.bytes),
        mediaType: document.mediaType,
        structureProfile:
          document.structureProfile ?? LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
        sha256: document.blob.sha256,
      };
    });
  }

  /**
   * Stores what the runtime produced. A result for a stale attempt or a frozen version is
   * ignored, so a slow or duplicated delivery can never overwrite a newer outcome.
   */
  async recordIngestionResult(input: {
    documentRowId: string;
    result: LegalSourceIngestionResult;
    correlationId: string;
  }): Promise<{ applied: boolean; state: string }> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.legalSourceDocument.findUnique({
        where: { id: input.documentRowId },
      });
      if (!found) {
        throw problemException(Errors.documentNotFound, input.correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }
      const version = await this.lockVersion(
        tx,
        found.legalSourceVersionId,
        input.correlationId,
      );
      const document = await tx.legalSourceDocument.findUniqueOrThrow({
        where: { id: found.id },
      });
      if (
        version.status !== Lifecycle.draft ||
        document.ingestionAttempt !== input.result.attempt ||
        document.ingestionState ===
          toPrismaLegalSourceDocumentIngestionState(States.READY)
      ) {
        return { applied: false, state: document.ingestionState };
      }

      if (input.result.outcome === LEGAL_SOURCE_INGESTION_OUTCOMES.FAILED) {
        await tx.legalSourceDocument.update({
          where: { id: document.id },
          data: {
            ingestionState: toPrismaLegalSourceDocumentIngestionState(
              States.FAILED,
            ),
            ingestionFailureCode: input.result.failureCode,
          },
        });
        await this.dropStructuralIndex(tx, version);
        return { applied: true, state: States.FAILED };
      }

      const chunks = input.result.chunks;
      const provisionStatuses =
        document.provenance &&
        typeof document.provenance === "object" &&
        !Array.isArray(document.provenance)
          ? ((
              document.provenance as {
                provisionStatuses?: Record<
                  string,
                  { status: LegalEffectStatus; sourceRef?: string }
                >;
              }
            ).provisionStatuses ?? {})
          : {};
      const locators = new Set<string>();
      for (const chunk of chunks) {
        const unique = !locators.has(chunk.locator);
        locators.add(chunk.locator);
        if (
          !unique ||
          chunk.content.length > MAX_CHUNK_CONTENT ||
          chunk.content.includes("\u0000") ||
          sha256Ref(chunk.content) !== chunk.contentSha256
        ) {
          throw problemException(
            Errors.ingestionResultInvalid,
            input.correlationId,
            {
              status: HttpStatus.UNPROCESSABLE_ENTITY,
              meta: { reason: unique ? "CHUNK_INVALID" : "DUPLICATE_LOCATOR" },
            },
          );
        }
      }
      if (
        Object.keys(provisionStatuses).some((locator) => !locators.has(locator))
      ) {
        throw problemException(
          Errors.ingestionResultInvalid,
          input.correlationId,
          {
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            meta: { reason: "STATUS_LOCATOR_NOT_FOUND" },
          },
        );
      }
      await tx.legalDocumentChunk.deleteMany({
        where: { legalSourceDocumentId: document.id },
      });
      for (
        let start = 0;
        start < chunks.length;
        start += PERSISTED_CHUNK_BATCH
      ) {
        await tx.legalDocumentChunk.createMany({
          data: chunks
            .slice(start, start + PERSISTED_CHUNK_BATCH)
            .map((chunk) => ({
              id: managedChunkId(
                version.id,
                document.documentId,
                chunk.locator,
              ),
              legalSourceVersionId: version.id,
              legalSourceDocumentId: document.id,
              documentId: document.documentId,
              locator: chunk.locator,
              content: chunk.content,
              contentSha256: chunk.contentSha256,
              hierarchy: chunk.hierarchy as Prisma.InputJsonObject,
              legalStatus: LEGAL_SOURCE_CHUNK_STATUSES.ACTIVE,
              legalEffectStatus:
                provisionStatuses[chunk.locator]?.status ??
                LEGAL_EFFECT_STATUSES.UNKNOWN,
              legalStatusSourceRef:
                provisionStatuses[chunk.locator]?.sourceRef ?? null,
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
            })),
        });
      }
      await tx.legalSourceDocument.update({
        where: { id: document.id },
        data: {
          ingestionState: toPrismaLegalSourceDocumentIngestionState(
            States.READY,
          ),
          ingestionFailureCode: null,
          ingestedAt: new Date(),
          structureProfile: input.result.extraction.structureProfile,
          extraction: input.result.extraction,
        },
      });
      await this.ensureStructuralIndex(tx, version);
      return { applied: true, state: States.READY };
    });
  }

  /**
   * Validates a version and records the result as its retrieval index. Idempotent: an unchanged
   * content hash keeps the existing row; changed content replaces it. Returns null when a document
   * is not READY or validation fails (the version then has no valid index).
   */
  async ensureStructuralIndex(
    tx: Tx,
    version: LockedVersion,
  ): Promise<{ validationRef: string; contentHash: string } | null> {
    const documents = await tx.legalSourceDocument.findMany({
      where: { legalSourceVersionId: version.id },
      include: { chunks: true },
    });
    const indexVersion = structuralIndexVersion(version.version);
    if (
      documents.length === 0 ||
      documents.some(
        (document) =>
          document.ingestionState !==
          toPrismaLegalSourceDocumentIngestionState(States.READY),
      )
    ) {
      await tx.legalRetrievalIndex.deleteMany({
        where: { version: indexVersion },
      });
      return null;
    }
    const validation = validateStructure(
      documents.map((document) => ({
        documentId: document.documentId,
        chunks: document.chunks,
      })),
    );
    await tx.legalRetrievalIndex.deleteMany({
      where: { version: indexVersion },
    });
    if (!validation.valid) return null;
    const validationRef = structuralValidationRef(validation.contentHash);
    await tx.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId: version.id,
        version: indexVersion,
        status: LegalRetrievalIndexStatus.VALID,
        configHash: STRUCTURAL_CONFIG_HASH,
        contentHash: validation.contentHash,
        validationManifestRef: validationRef,
        validatedAt: new Date(),
      },
    });
    return { validationRef, contentHash: validation.contentHash };
  }

  // -- internals -------------------------------------------------------------------------

  private async addDocument(
    input: NewDocument,
  ): Promise<LegalSourceDocumentView> {
    if (input.bytes.length === 0) {
      throw problemException(Errors.documentEmpty, input.correlationId, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    if (input.bytes.length > LEGAL_SOURCE_LIMITS.maxDocumentBytes) {
      throw problemException(Errors.documentTooLarge, input.correlationId, {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
      });
    }
    const mediaType = detectMediaType({
      bytes: input.bytes,
      declaredType: input.declaredType,
      fileName: input.fileName,
    });
    if (!mediaType) {
      throw problemException(
        Errors.documentUnsupportedMediaType,
        input.correlationId,
        { status: HttpStatus.UNSUPPORTED_MEDIA_TYPE },
      );
    }
    const sha256 = sha256Ref(input.bytes).slice("sha256:".length);

    return this.prisma.$transaction(async (tx) => {
      const version = await this.lockDraft(
        tx,
        input.versionId,
        input.correlationId,
      );
      const existing = await tx.legalSourceDocument.findMany({
        where: { legalSourceVersionId: version.id },
        select: { documentId: true, blobSha256: true },
      });
      if (existing.length >= LEGAL_SOURCE_LIMITS.maxDocumentsPerVersion) {
        throw problemException(
          Errors.documentLimitReached,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      if (existing.some((document) => document.blobSha256 === sha256)) {
        throw problemException(Errors.documentDuplicate, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      await tx.legalSourceDocumentBlob.createMany({
        data: [
          {
            sha256,
            byteLength: input.bytes.length,
            bytes: new Uint8Array(input.bytes),
          },
        ],
        skipDuplicates: true,
      });

      const title =
        input.title ?? input.fileName.replace(/\.[A-Za-z0-9]{1,8}$/u, "");
      const taken = new Set(existing.map((document) => document.documentId));
      const base = documentIdFrom(title);
      let documentId = base;
      for (let n = 2; taken.has(documentId); n += 1)
        documentId = `${base}-${n}`;

      const created = await tx.legalSourceDocument.create({
        data: {
          legalSourceVersionId: version.id,
          documentId,
          title,
          sourceUrl: input.sourceUrl,
          sourceSha256: `sha256:${sha256}`,
          sourceEffectStatus: input.sourceEffectStatus ?? NOT_STATED,
          effectiveDate: input.effectiveDate
            ? new Date(`${input.effectiveDate}T00:00:00.000Z`)
            : null,
          origin: toPrismaLegalSourceDocumentOrigin(input.origin),
          ingestionState: toPrismaLegalSourceDocumentIngestionState(
            States.PENDING,
          ),
          ingestionAttempt: 1,
          mediaType,
          originalFileName: input.fileName,
          byteLength: input.bytes.length,
          blobSha256: sha256,
          structureProfile: input.structureProfile,
          provenance: input.provenance,
          createdBy: input.actorId,
        },
      });
      await this.dropStructuralIndex(tx, version);
      await this.enqueueIngestion(tx, {
        version,
        document: created,
        attempt: 1,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      await this.record(
        tx,
        input.origin === Origins.UPLOAD
          ? "LEGAL_SOURCE_DOCUMENT_UPLOADED"
          : "LEGAL_SOURCE_DOCUMENT_IMPORTED",
        input,
        version.id,
        {
          documentRowId: created.id,
          documentId,
          mediaType,
          byteLength: input.bytes.length,
          sourceSha256: `sha256:${sha256}`,
        },
      );
      return this.view(tx, created.id, true);
    });
  }

  private async enqueueIngestion(
    tx: Tx,
    input: {
      version: LockedVersion;
      document: {
        id: string;
        documentId: string;
        blobSha256: string | null;
        mediaType: string | null;
        structureProfile: string | null;
        byteLength: number | null;
      };
      attempt: number;
      actorId: string;
      correlationId: string;
    },
  ): Promise<void> {
    await this.outbox.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.legalSourceVersion,
        aggregateId: input.version.id,
        eventType: LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
        correlationId: input.correlationId,
        causationId: input.document.id,
        actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
        result: AGENTIC_TOOL_STATUSES.ready,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${input.document.id}:ingest:${input.attempt}`,
        payload: {
          legalSourceVersionId: input.version.id,
          documentRowId: input.document.id,
          documentId: input.document.documentId,
          attempt: input.attempt,
          blobSha256: input.document.blobSha256,
          mediaType: input.document.mediaType,
          structureProfile: input.document.structureProfile,
          byteLength: input.document.byteLength,
        },
      }),
      tx,
    );
  }

  private async dropStructuralIndex(tx: Tx, version: LockedVersion) {
    await tx.legalRetrievalIndex.deleteMany({
      where: {
        legalSourceVersionId: version.id,
        version: structuralIndexVersion(version.version),
      },
    });
  }

  private async deleteOrphanBlobs(tx: Tx, sha256: string | null) {
    if (!sha256) return;
    await tx.legalSourceDocumentBlob.deleteMany({
      where: { sha256, documents: { none: {} } },
    });
  }

  private async record(
    tx: Tx,
    eventType: string,
    input: { actorId: string; correlationId: string },
    versionId: string,
    payload: Record<string, unknown>,
  ) {
    await this.audit.writeInTx(
      {
        eventType,
        actorId: input.actorId,
        resourceType: AUDIT_RESOURCE_TYPES.legalSourceVersion,
        resourceId: versionId,
        decision: AUDIT_DECISIONS.allow,
        correlationId: input.correlationId,
        payload: {
          indexTool: LEGAL_SOURCE_STRUCTURAL_INDEX.tool,
          ...payload,
        },
      },
      tx,
    );
  }

  private async view(
    tx: Tx,
    documentRowId: string,
    draft: boolean,
  ): Promise<LegalSourceDocumentView> {
    const row = await tx.legalSourceDocument.findUniqueOrThrow({
      where: { id: documentRowId },
      include: { _count: { select: { chunks: true } } },
    });
    return toDocumentView(row, draft);
  }

  private async findDocument(
    tx: Tx,
    versionId: string,
    documentRowId: string,
    correlationId: string,
  ) {
    const document = await tx.legalSourceDocument.findFirst({
      where: { id: documentRowId, legalSourceVersionId: versionId },
    });
    if (!document) {
      throw problemException(Errors.documentNotFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    return document;
  }

  private async requireDraft(versionId: string, correlationId: string) {
    const version = await this.prisma.legalSourceVersion.findUnique({
      where: { id: versionId },
      select: { status: true },
    });
    if (!version) {
      throw problemException(Errors.sourceNotFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    if (
      version.status !== toPrismaLegalSourceLifecycleStatus(Lifecycle.draft)
    ) {
      throw problemException(Errors.versionImmutable, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
  }

  private async lockVersion(
    tx: Tx,
    versionId: string,
    correlationId: string,
  ): Promise<LockedVersion> {
    const rows = await tx.$queryRaw<LockedVersion[]>(
      Prisma.sql`SELECT id, status::text AS status, version FROM "LegalSourceVersion" WHERE id = ${versionId} FOR UPDATE`,
    );
    if (!rows[0]) {
      throw problemException(Errors.sourceNotFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    return rows[0];
  }

  private async lockDraft(
    tx: Tx,
    versionId: string,
    correlationId: string,
  ): Promise<LockedVersion> {
    const version = await this.lockVersion(tx, versionId, correlationId);
    if (version.status !== Lifecycle.draft) {
      throw problemException(Errors.versionImmutable, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return version;
  }
}
