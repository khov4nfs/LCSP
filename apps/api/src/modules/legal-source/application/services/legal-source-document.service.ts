import { HttpStatus, Injectable } from "@nestjs/common";
import { discardDraftDocumentGraphs } from "./discard-draft-document-graph.js";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  LEGAL_SOURCE_CHUNK_STATUSES,
  LEGAL_SOURCE_EVENT_TYPES,
  type UpdateLegalSourceDocumentCorpusRole,
  LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
  LEGAL_SOURCE_INGESTION_OUTCOMES,
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES as States,
  LEGAL_SOURCE_DOCUMENT_ORIGINS as Origins,
  LEGAL_SOURCE_LIFECYCLE_STATUSES as Lifecycle,
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  LEGAL_SOURCE_STRUCTURAL_INDEX,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  type ImportLegalSourceDocumentRequest,
  type LegalSourceChunkPage,
  type LegalSourceChunkQuery,
  type LegalSourceDocumentView,
  type LegalSourceIngestionResult,
  type UpdateLegalSourceDocumentEffect,
  type UploadLegalSourceDocumentMetadata,
} from "@lcsp/contracts/legal-source";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  LegalEffectStatus,
  LegalRetrievalIndexStatus,
  Prisma,
} from "@prisma/client";

import {
  toPrismaLegalSourceDocumentIngestionState,
  toPrismaLegalSourceDocumentCorpusRole,
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

  /**
   * Business purpose: Snapshot an uploaded legal document into a draft legal-source version.
   *
   * Business rules:
   * - Sanitize the uploaded filename, preserve submitted effect/structure metadata and identify the origin as UPLOAD; shared admission enforces draft and document limits.
   *
   * Execution flow:
   * 1. Normalize filename and upload provenance.
   * 2. Delegate immutable byte storage, ingestion enqueue and audit to addDocument.
   *
   * Failure cases:
   * - Empty, oversized, unsupported, duplicate or non-draft documents are rejected by the shared admission path; no partial upload is acknowledged.
   *
   * Side effects:
   * - May persist a content-addressed blob/document and transactionally enqueue ingestion and audit through addDocument.
   */
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
  /**
   * Business purpose: Import a public legal document once so later use depends on pinned bytes, not the live URL.
   *
   * Business rules:
   * - Precheck draft eligibility before network fetch and recheck under the add-document transaction lock.
   * - Use SafeUrlFetcher and preserve redirect/retrieval provenance without treating the URL as immutable source content.
   *
   * Execution flow:
   * 1. Verify draft status and fetch through the public-URL safety boundary.
   * 2. Normalize imported metadata and persist the returned byte snapshot through addDocument.
   *
   * Failure cases:
   * - ImportRejectedError becomes importUrlRejected with 422 and its safe reason; other fetch failures propagate and draft/byte constraints remain enforced.
   *
   * Side effects:
   * - Fetches a public URL and may persist its immutable snapshot, ingestion outbox command and audit record.
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

  /**
   * Business purpose: Start a new fenced ingestion attempt for an eligible draft legal document.
   *
   * Business rules:
   * - Lock the DRAFT version and require a document with original blob/media metadata; READY documents cannot be retried.
   * - Incrementing ingestionAttempt makes older worker results stale.
   *
   * Execution flow:
   * 1. Validate version/document eligibility under transaction lock.
   * 2. Invalidate derived graph/index/chunks and reset extraction state to PENDING.
   * 3. Enqueue the new attempt, audit the retry and return the refreshed document view.
   *
   * Failure cases:
   * - Missing document/version or immutable version rejects; documentNotRetryable returns 409 for READY or missing-source documents; transaction failure rolls back all writes.
   *
   * Side effects:
   * - Deletes stale derived data, updates ingestion attempt/state, and transactionally writes outbox and audit records.
   */
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
      await this.dropStructuralIndex(tx, version);
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

  /**
   * Business purpose: Remove a document and its now-invalid derived authority from a draft legal-source version.
   *
   * Business rules:
   * - Require a locked DRAFT version and a document belonging to it; original blobs are removed only when no document references them.
   *
   * Execution flow:
   * 1. Lock and locate the draft document.
   * 2. Drop derived structural authority, delete the document and collect an orphan blob.
   * 3. Record the removal audit in the same transaction.
   *
   * Failure cases:
   * - Missing or immutable version/document rejects; transaction failure prevents partial durable removal.
   *
   * Side effects:
   * - Deletes the draft document/derived graph/index, may remove an unreferenced blob, and writes audit evidence.
   */
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
      await this.dropStructuralIndex(tx, version);
      await tx.legalSourceDocument.delete({ where: { id: document.id } });
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

  /**
   * Business purpose: Change whether a draft legal document contributes primary review or reference-only context without altering pinned Preparation denominators.
   *
   * Business rules:
   * - Require a locked DRAFT version; any existing Preparation run, including diagnostics, blocks corpus-role changes.
   * - Return the current view without mutation when the eligible document already has the requested role.
   *
   * Execution flow:
   * 1. Lock the version and reject pinned Preparation use.
   * 2. Locate the document and compare its mapped role.
   * 3. Persist a changed role, discard derived graphs and audit the update.
   *
   * Failure cases:
   * - A version in use returns versionInUse 409; missing/immutable targets reject; transaction failures roll back role and derived-graph writes.
   *
   * Side effects:
   * - May update document corpus role, discard draft graph materializations and write audit evidence; no source bytes change.
   */
  async updateCorpusRole(input: {
    versionId: string;
    documentRowId: string;
    actorId: string;
    correlationId: string;
    request: UpdateLegalSourceDocumentCorpusRole;
  }): Promise<LegalSourceDocumentView> {
    return this.prisma.$transaction(
      async (tx) => {
        const version = await this.lockDraft(
          tx,
          input.versionId,
          input.correlationId,
        );
        // A diagnostic can pin a DRAFT; changing its denominator would invalidate the persisted frontier.
        if (
          await tx.ruleSetPreparationRun.count({
            where: { legalSourceVersionId: version.id },
          })
        )
          throw problemException(Errors.versionInUse, input.correlationId, {
            status: HttpStatus.CONFLICT,
          });
        const document = await this.findDocument(
          tx,
          version.id,
          input.documentRowId,
          input.correlationId,
        );
        const role = toPrismaLegalSourceDocumentCorpusRole(
          input.request.corpusRole,
        );
        if (document.corpusRole === role)
          return this.view(tx, document.id, true);
        await tx.legalSourceDocument.update({
          where: { id: document.id },
          data: { corpusRole: role },
        });
        await discardDraftDocumentGraphs(tx, version.id);
        await this.record(
          tx,
          LEGAL_SOURCE_EVENT_TYPES.documentCorpusRoleUpdated,
          input,
          version.id,
          {
            documentRowId: document.id,
            documentId: document.documentId,
            corpusRole: input.request.corpusRole,
          },
        );
        return this.view(tx, document.id, true);
        // Discarding a full draft materialization (thousands of nodes) outlasts Prisma's 5 s default.
      },
      { maxWait: 10000, timeout: 120000 },
    );
  }

  /**
   * Business purpose: Record declared legal-effect metadata for a READY document in a draft source version.
   *
   * Business rules:
   * - Require a locked DRAFT version and READY document; provision overrides must cite existing chunk locators.
   * - Stored metadata is a declaration, not an independent legal-effect determination.
   *
   * Execution flow:
   * 1. Validate target document and override locators.
   * 2. Apply the document default effect to all chunks and then grouped provision overrides.
   * 3. Update provenance/effective date, invalidate derived graphs, rebuild structural index and audit the change.
   *
   * Failure cases:
   * - Missing/non-READY document returns 404, immutable version conflicts, unknown override locator returns ingestionResultInvalid 422; transaction failure rolls back the metadata changes.
   *
   * Side effects:
   * - Updates document/chunk effect provenance, replaces derived authority and writes an audit record in one transaction.
   */
  async updateEffect(input: {
    versionId: string;
    documentRowId: string;
    actorId: string;
    correlationId: string;
    request: UpdateLegalSourceDocumentEffect;
  }): Promise<LegalSourceDocumentView> {
    return this.prisma.$transaction(async (tx) => {
      const version = await this.lockDraft(
        tx,
        input.versionId,
        input.correlationId,
      );
      const document = await tx.legalSourceDocument.findFirst({
        where: {
          id: input.documentRowId,
          legalSourceVersionId: version.id,
          ingestionState: toPrismaLegalSourceDocumentIngestionState(
            States.READY,
          ),
        },
        include: { chunks: { select: { locator: true } } },
      });
      if (!document) {
        throw problemException(Errors.documentNotFound, input.correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }
      const locators = new Set(document.chunks.map((chunk) => chunk.locator));
      if (
        Object.keys(input.request.provisionStatuses).some(
          (locator) => !locators.has(locator),
        )
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

      await tx.legalDocumentChunk.updateMany({
        where: { legalSourceDocumentId: document.id },
        data: {
          legalEffectStatus: input.request.status,
          legalStatusSourceRef: input.request.sourceRef ?? null,
        },
      });
      const overrideGroups = new Map<
        string,
        {
          status: LegalEffectStatus;
          sourceRef: string | null;
          locators: string[];
        }
      >();
      for (const [locator, entry] of Object.entries(
        input.request.provisionStatuses,
      )) {
        const status = entry.status;
        const sourceRef = entry.sourceRef ?? null;
        const key = JSON.stringify([status, sourceRef]);
        const group = overrideGroups.get(key) ?? {
          status,
          sourceRef,
          locators: [],
        };
        group.locators.push(locator);
        overrideGroups.set(key, group);
      }
      for (const group of overrideGroups.values()) {
        await tx.legalDocumentChunk.updateMany({
          where: {
            legalSourceDocumentId: document.id,
            locator: { in: group.locators },
          },
          data: {
            legalEffectStatus: group.status,
            legalStatusSourceRef: group.sourceRef,
          },
        });
      }

      const previous =
        document.provenance &&
        typeof document.provenance === "object" &&
        !Array.isArray(document.provenance)
          ? document.provenance
          : {};
      await tx.legalSourceDocument.update({
        where: { id: document.id },
        data: {
          sourceEffectStatus: input.request.status,
          ...(input.request.effectiveDate !== undefined
            ? {
                effectiveDate: input.request.effectiveDate
                  ? new Date(`${input.request.effectiveDate}T00:00:00.000Z`)
                  : null,
              }
            : {}),
          provenance: {
            ...previous,
            provisionStatuses: input.request.provisionStatuses,
            legalEffectMetadata: {
              status: input.request.status,
              sourceRef: input.request.sourceRef ?? null,
            },
          },
        },
      });
      await discardDraftDocumentGraphs(tx, version.id);
      await this.ensureStructuralIndex(tx, version);
      await this.record(
        tx,
        LEGAL_SOURCE_EVENT_TYPES.documentEffectUpdated,
        input,
        version.id,
        {
          documentRowId: document.id,
          documentId: document.documentId,
          status: input.request.status,
          statusOverrideCount: Object.keys(input.request.provisionStatuses)
            .length,
        },
      );
      return this.view(tx, document.id, true);
    });
  }

  /**
   * Business purpose: Download the stored original bytes of a legal document within the supplied version/active scope.
   *
   * Business rules:
   * - Require matching scope, a stored blob and media type; use the blob's immutable hash and original filename where available.
   *
   * Execution flow:
   * 1. Find the document and blob under scope filters.
   * 2. Return copied bytes with media type, filename and hash.
   *
   * Failure cases:
   * - Missing/out-of-scope document, absent blob or absent media type returns documentNotFound 404.
   *
   * Side effects:
   * - Read-only database access; never refetches or changes the original source.
   */
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

  /**
   * Business purpose: Return a paginated view of persisted legal-document chunks within the caller's selected source scope.
   *
   * Business rules:
   * - Apply supplied version and active-only filters before exposing chunks; preserve page and chunk-hash/effect provenance.
   *
   * Execution flow:
   * 1. Find the scoped document or reject it.
   * 2. Count and retrieve chunks ordered by page then identity.
   * 3. Return their content/provenance and requested pagination.
   *
   * Failure cases:
   * - A missing/out-of-scope document returns documentNotFound 404; query failures propagate rather than return a successful empty document.
   *
   * Side effects:
   * - Read-only database queries; no ingestion, source or lifecycle mutation.
   */
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
  /**
   * Business purpose: Provide the worker the exact stored bytes for the current draft document ingestion attempt.
   *
   * Business rules:
   * - Require a stored blob and media type, a DRAFT version and matching attempt; only PENDING transitions to PROCESSING.
   *
   * Execution flow:
   * 1. Load the document/blob and lock its version.
   * 2. Verify attempt/version eligibility and advance pending work to PROCESSING.
   * 3. Return original bytes, media type, structure profile and blob hash.
   *
   * Failure cases:
   * - Missing source returns documentNotFound 404; immutable version or stale attempt returns documentNotRetryable 409; transaction failures roll back the state change.
   *
   * Side effects:
   * - May update ingestion state to PROCESSING; returns stored immutable bytes without fetching the source URL.
   */
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
  /**
   * Business purpose: Apply a current worker extraction result while preserving original-source and chunk integrity.
   *
   * Business rules:
   * - Ignore stale attempts, non-draft versions and already READY documents; failed outcomes cannot become successful extraction.
   * - Accepted pages/chunks require matching hashes, unique locators, bounded content and valid status-override locators.
   *
   * Execution flow:
   * 1. Lock and recheck document/attempt eligibility.
   * 2. Persist failure state or validate extracted text and all chunks before replacing derived data.
   * 3. Write chunks in bounded batches, mark the document READY and rebuild a valid structural index when possible.
   *
   * Failure cases:
   * - Missing document returns 404; invalid text/chunk hash, duplicate locator, oversized/NUL content or unknown status locator returns ingestionResultInvalid 422; transaction errors roll back writes.
   *
   * Side effects:
   * - Updates ingestion state/extraction, replaces chunks and draft graph/index authority; stale callbacks return applied:false without those mutations.
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
      const pages = input.result.extraction.pages;
      if (
        pages &&
        (pages.some((page) => page.includes("\u0000")) ||
          sha256Ref(pages.join("\n")) !== input.result.extraction.textSha256)
      ) {
        throw problemException(
          Errors.ingestionResultInvalid,
          input.correlationId,
          {
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            meta: { reason: "EXTRACTED_TEXT_HASH_MISMATCH" },
          },
        );
      }
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
      const provisionStatuses =
        (
          document.provenance as {
            provisionStatuses?: Record<
              string,
              { status: LegalEffectStatus; sourceRef?: string }
            >;
          } | null
        )?.provisionStatuses ?? {};
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
      await discardDraftDocumentGraphs(tx, version.id);
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
              legalStatus: "UNKNOWN",
              legalEffectStatus:
                provisionStatuses[chunk.locator]?.status ??
                LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN,
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
  /**
   * Business purpose: Publish a structural retrieval index only when the version's complete document collection is READY and structurally valid.
   *
   * Business rules:
   * - Empty collections or any non-READY document cannot retain the structural index; structural validation does not establish semantic legal compliance.
   *
   * Execution flow:
   * 1. Read all version documents and chunks and remove stale index records.
   * 2. Validate the complete structure when all documents are READY.
   * 3. Persist VALID index provenance and return its manifest/hash, or return null when ineligible/invalid.
   *
   * Failure cases:
   * - Incomplete or structurally invalid collections return null after invalidating stale index records; database/validation exceptions propagate to the transaction.
   *
   * Side effects:
   * - Replaces derived structural retrieval-index records with canonical content/config hashes and validation time when eligible.
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

  /**
   * Business purpose: Atomically admit a legal document's immutable bytes and create its first ingestion work item.
   *
   * Business rules:
   * - Reject empty/oversized/unsupported content and enforce per-version count and duplicate-byte limits under a DRAFT version lock.
   * - Store blobs by SHA-256, allocate a collision-free document ID and preserve provided source provenance.
   *
   * Execution flow:
   * 1. Validate bytes and detected media type, then hash the original content.
   * 2. Lock the draft, enforce collection constraints and create/reuse the blob plus PENDING document.
   * 3. Invalidate derived authority, enqueue attempt one, audit the origin and return the document view.
   *
   * Failure cases:
   * - Document validation yields the shared empty/too-large/unsupported/limit/duplicate errors; missing or immutable version rejects; all transaction writes roll back together on failure.
   *
   * Side effects:
   * - Creates blob/document metadata, discards stale graphs/index and writes ingestion outbox plus audit records transactionally.
   */
  private async addDocument(
    input: NewDocument,
  ): Promise<LegalSourceDocumentView> {
    if (input.bytes.byteLength === 0) {
      throw problemException(Errors.documentEmpty, input.correlationId, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    if (input.bytes.byteLength > LEGAL_SOURCE_LIMITS.maxDocumentBytes) {
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
            byteLength: input.bytes.byteLength,
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
          byteLength: input.bytes.byteLength,
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
          byteLength: input.bytes.byteLength,
          sourceSha256: `sha256:${sha256}`,
        },
      );
      return this.view(tx, created.id, true);
    });
  }

  /**
   * Business purpose: Durably hand one legal-document ingestion attempt to the runtime through the existing outbox.
   *
   * Business rules:
   * - Bind version/document/blob/media/profile provenance and use document ID plus attempt for idempotency; inherit the caller's transaction and actor/correlation.
   *
   * Execution flow:
   * 1. Build the canonical ingestion command envelope.
   * 2. Enqueue it in the supplied transaction under the legal-source version aggregate.
   *
   * Failure cases:
   * - Outbox persistence errors abort the caller's transaction; this method does not dispatch or independently retry the worker.
   *
   * Side effects:
   * - Writes one idempotent outbox message in the caller's transaction.
   */
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

  /**
   * Business purpose: Invalidate derived draft source authority after document content or membership changes.
   *
   * Business rules:
   * - Discard draft document graphs and remove only this version's named structural retrieval index.
   *
   * Execution flow:
   * 1. Discard draft graph materializations.
   * 2. Delete the matching structural index for the locked source version.
   *
   * Failure cases:
   * - Database errors propagate to the enclosing transaction; stale derived authority is not acknowledged as valid.
   *
   * Side effects:
   * - Deletes derived graph/index records within the supplied transaction; original bytes remain unchanged.
   */
  private async dropStructuralIndex(tx: Tx, version: LockedVersion) {
    await discardDraftDocumentGraphs(tx, version.id);
    await tx.legalRetrievalIndex.deleteMany({
      where: {
        legalSourceVersionId: version.id,
        version: structuralIndexVersion(version.version),
      },
    });
  }

  /**
   * Business purpose: Remove original document bytes only when no legal document still references them.
   *
   * Business rules:
   * - An absent hash is a no-op; deletion requires the exact hash and an empty referencing-document relation.
   *
   * Execution flow:
   * 1. Return when no blob identity exists.
   * 2. Delete only the unreferenced content-addressed blob matching that hash.
   *
   * Failure cases:
   * - Referenced or already-absent blobs produce no deletion; database failures propagate to the caller transaction.
   *
   * Side effects:
   * - May delete one unreferenced blob in the supplied transaction; shared source blobs remain preserved.
   */
  private async deleteOrphanBlobs(tx: Tx, sha256: string | null) {
    if (!sha256) return;
    await tx.legalSourceDocumentBlob.deleteMany({
      where: { sha256, documents: { none: {} } },
    });
  }

  /**
   * Business purpose: Audit an accepted legal-source document operation with the affected version and actor lineage.
   *
   * Business rules:
   * - Use the legal-source-version resource, ALLOW decision and caller transaction/correlation; include the structural index tool provenance.
   *
   * Execution flow:
   * 1. Combine event-specific payload with index-tool metadata.
   * 2. Write the audit event in the same transaction as the document operation.
   *
   * Failure cases:
   * - Audit persistence failure aborts the caller's transaction; no unaudited successful mutation is acknowledged.
   *
   * Side effects:
   * - Writes a transactional audit event; no separate model or notification dispatch.
   */
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

  /**
   * Business purpose: Return the canonical legal-document projection after a transaction's accepted operation.
   *
   * Business rules:
   * - Include persisted chunk count and apply the caller's draft capability flag through the shared mapper.
   *
   * Execution flow:
   * 1. Read the document with its chunk count.
   * 2. Map it to the shared LegalSourceDocumentView.
   *
   * Failure cases:
   * - A missing expected row propagates findUniqueOrThrow failure and aborts the enclosing transaction.
   *
   * Side effects:
   * - Read-only projection from the current transaction state.
   */
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

  /**
   * Business purpose: Prevent a document operation from crossing its selected legal-source version.
   *
   * Business rules:
   * - Both document row ID and owning version ID must match before returning a mutable document record.
   *
   * Execution flow:
   * 1. Find the document under the exact version scope.
   * 2. Return it or raise the shared document-not-found problem.
   *
   * Failure cases:
   * - Missing/out-of-scope document returns documentNotFound 404; persistence errors propagate.
   *
   * Side effects:
   * - Read-only lookup inside the caller's transaction.
   */
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

  /**
   * Business purpose: Reject an ineligible legal-source URL import before performing its external fetch.
   *
   * Business rules:
   * - A source version must exist and currently be DRAFT; the later mutation still rechecks eligibility under lock.
   *
   * Execution flow:
   * 1. Read version lifecycle status.
   * 2. Reject a missing or immutable version and otherwise allow fetch preparation.
   *
   * Failure cases:
   * - Missing version returns sourceNotFound 404; non-draft version returns versionImmutable 409.
   *
   * Side effects:
   * - Read-only database precheck; no row lock, external fetch or persistence here.
   */
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

  /**
   * Business purpose: Serialize legal-document lifecycle operations on their owning source version.
   *
   * Business rules:
   * - Lock the exact version row for update within the supplied transaction and preserve its stored status/version.
   *
   * Execution flow:
   * 1. Select the source version with a parameterized FOR UPDATE query.
   * 2. Return the locked identity or reject absence.
   *
   * Failure cases:
   * - Missing version returns sourceNotFound 404; database lock/query failures propagate to the transaction.
   *
   * Side effects:
   * - Acquires a version row lock; does not change lifecycle or source data.
   */
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

  /**
   * Business purpose: Serialize a document mutation against the source version's immutable lifecycle boundary.
   *
   * Business rules:
   * - The locked version must be DRAFT before mutation; no active/archived version is writable through this guard.
   *
   * Execution flow:
   * 1. Acquire the version row lock.
   * 2. Reject non-draft status or return the locked version identity.
   *
   * Failure cases:
   * - Missing version returns sourceNotFound 404; immutable version returns versionImmutable 409.
   *
   * Side effects:
   * - Acquires a database row lock in the caller's transaction; makes no data mutation itself.
   */
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
