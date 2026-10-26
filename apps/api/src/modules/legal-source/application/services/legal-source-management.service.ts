import { randomUUID } from "node:crypto";
import { discardDraftDocumentGraphs } from "./discard-draft-document-graph.js";

import { HttpStatus, Injectable } from "@nestjs/common";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES as States,
  LEGAL_SOURCE_LIFECYCLE_STATUSES as Lifecycle,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  LEGAL_SOURCE_VERSION_BLOCKERS as Blockers,
  type ActiveLegalLibrary,
  type CreateLegalSourceRequest,
  type CreateLegalSourceVersionRequest,
  type LegalSourceDetail,
  type LegalSourceList,
  type LegalSourceVersionDetail,
  type UpdateLegalSourceRequest,
} from "@lcsp/contracts/legal-source";
import { LegalRetrievalIndexStatus, Prisma } from "@prisma/client";

import {
  toPrismaLegalSourceDocumentIngestionState,
  toPrismaLegalSourceLifecycleStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { documentIdFrom } from "./document-media-type.js";
import { LegalSourceDocumentService } from "./legal-source-document.service.js";
import {
  structuralIndexVersion,
  structuralIntegrityRef,
  managedChunkId,
} from "./legal-source-structure.js";
import {
  toDocumentView,
  toSourceDetail,
  toSourceSummary,
  toVersionDetail,
  versionBlockers,
} from "./legal-source-views.js";
import { LegalSourceService } from "./legal-source.service.js";

const VERSION_INCLUDE = {
  documents: { select: { ingestionState: true } },
  _count: { select: { chunks: true } },
} as const;

/**
 * Business purpose: Recognize the database uniqueness conflict used to resolve legal-source slug collisions.
 *
 * Business rules:
 * - Only Prisma known-request errors with code P2002 count as unique violations.
 * - Other database and application failures must propagate unchanged to the caller.
 *
 * Execution flow:
 * 1. Check the Prisma error class and its stable error code.
 * 2. Return whether both identify a unique-constraint violation.
 *
 * Failure cases:
 * - Errors without Prisma's P2002 uniqueness code return false so callers preserve their original handling.
 *
 * Side effects:
 * - None: the helper classifies an error without changing persistence or the error object.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Business purpose: Derive a usable default slug from a legal-source name when the caller did not supply one.
 *
 * Business rules:
 * - Slugs reuse the document identifier normalization rules.
 * - A generated slug shorter than three characters receives the `-source` suffix so it is not an undersized source key.
 *
 * Execution flow:
 * 1. Normalize the source name with `documentIdFrom`.
 * 2. Return the normalized value or append the fallback suffix when it is too short.
 *
 * Failure cases:
 * - Empty or punctuation-only names inherit `documentIdFrom`'s `document` fallback.
 *
 * Side effects:
 * - None: this function derives a slug candidate and does not reserve it.
 */
function slugFrom(name: string): string {
  const slug = documentIdFrom(name);
  return slug.length >= 3 ? slug : `${slug}-source`;
}

@Injectable()
export class LegalSourceManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriterService,
    private readonly documents: LegalSourceDocumentService,
    private readonly legalSource: LegalSourceService,
  ) {}

  /**
   * Business purpose: List legal sources with their version summaries for the administration library.
   *
   * Business rules:
   * - Source rows are ordered by creation time ascending and each included version is projected through the shared summary mapper.
   * - This method does not filter by actor; caller authorization controls who may access the management library.
   *
   * Execution flow:
   * 1. Load all sources and the document-readiness and chunk-count fields needed for version summaries.
   * 2. Map the rows into the legal-source list contract.
   *
   * Failure cases:
   * - Prisma read errors propagate; there is no partial or synthetic list result.
   *
   * Side effects:
   * - None beyond read-only Prisma access and in-memory projection.
   */
  async listSources(): Promise<LegalSourceList> {
    const sources = await this.prisma.legalSource.findMany({
      orderBy: { createdAt: "asc" },
      include: { versions: { include: VERSION_INCLUDE } },
    });
    return { items: sources.map(toSourceSummary) };
  }

  /**
   * Business purpose: Return one legal source's metadata and version lifecycle details by source identifier.
   *
   * Business rules:
   * - The source must exist; version readiness and active/latest status are derived from stored values by the view mapper.
   * - This method relies on caller authorization and does not perform actor filtering itself.
   *
   * Execution flow:
   * 1. Load the source and required version summary data by primary key.
   * 2. Raise the source-not-found problem when absent, otherwise return the mapped source detail.
   *
   * Failure cases:
   * - A missing source raises `sourceNotFound` with HTTP 404 and the supplied correlation identifier.
   *
   * Side effects:
   * - None beyond read-only Prisma access.
   */
  async getSource(
    sourceId: string,
    correlationId: string,
  ): Promise<LegalSourceDetail> {
    const source = await this.prisma.legalSource.findUnique({
      where: { id: sourceId },
      include: { versions: { include: VERSION_INCLUDE } },
    });
    if (!source) throw this.notFound(correlationId);
    return toSourceDetail(source);
  }

  /**
   * Business purpose: Register a named legal source and return its initial management detail.
   *
   * Business rules:
   * - An explicit slug is used as supplied; otherwise the source name produces a normalized slug candidate.
   * - Generated-slug collisions receive numbered suffixes for at most 25 attempts, while an explicit collision is a conflict.
   * - Creation is audited under the requesting actor and correlation identifier.
   *
   * Execution flow:
   * 1. Select the explicit or generated slug base.
   * 2. Try to create the source, adding a suffix after generated-slug uniqueness conflicts.
   * 3. Write the creation audit event and reload the created source detail.
   *
   * Failure cases:
   * - An explicit slug collision or exhaustion of generated candidates raises `slugTaken` with HTTP 409.
   * - Non-unique persistence, audit, or reload failures propagate; creation and audit are not wrapped in one transaction here.
   *
   * Side effects:
   * - Creates a LegalSource row and writes a `LEGAL_SOURCE_CREATED` audit record; the follow-up detail read is read-only.
   */
  async createSource(input: {
    actorId: string;
    correlationId: string;
    request: CreateLegalSourceRequest;
  }): Promise<LegalSourceDetail> {
    const explicit = input.request.slug;
    const base = explicit ?? slugFrom(input.request.name);
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      try {
        const created = await this.prisma.legalSource.create({
          data: {
            slug,
            name: input.request.name,
            description: input.request.description ?? null,
            createdBy: input.actorId,
          },
        });
        await this.audit.write({
          eventType: "LEGAL_SOURCE_CREATED",
          actorId: input.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.legalSourceVersion,
          resourceId: created.id,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          payload: { legalSourceId: created.id, slug },
        });
        return this.getSource(created.id, input.correlationId);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (explicit) {
          throw problemException(Errors.slugTaken, input.correlationId, {
            status: HttpStatus.CONFLICT,
          });
        }
      }
    }
    throw problemException(Errors.slugTaken, input.correlationId, {
      status: HttpStatus.CONFLICT,
    });
  }

  /**
   * Business purpose: Update the editable name and description of an existing legal source.
   *
   * Business rules:
   * - Only request fields explicitly supplied are changed; omitted name or description values are preserved.
   * - The source identity and all version content remain unchanged by this operation.
   *
   * Execution flow:
   * 1. Confirm that the source identifier exists.
   * 2. Persist only the provided editable fields and reload the source detail.
   *
   * Failure cases:
   * - A missing source raises `sourceNotFound` with HTTP 404; persistence or reload errors propagate.
   *
   * Side effects:
   * - Updates the LegalSource row; it does not write an audit event in this method.
   */
  async updateSource(input: {
    sourceId: string;
    actorId: string;
    correlationId: string;
    request: UpdateLegalSourceRequest;
  }): Promise<LegalSourceDetail> {
    const existing = await this.prisma.legalSource.findUnique({
      where: { id: input.sourceId },
      select: { id: true },
    });
    if (!existing) throw this.notFound(input.correlationId);
    await this.prisma.legalSource.update({
      where: { id: input.sourceId },
      data: {
        ...(input.request.name !== undefined
          ? { name: input.request.name }
          : {}),
        ...(input.request.description !== undefined
          ? { description: input.request.description }
          : {}),
      },
    });
    return this.getSource(input.sourceId, input.correlationId);
  }

  /**
   * Business purpose: Start the next draft version of a legal source, optionally copying ready content from an earlier version.
   *
   * Business rules:
   * - A source-row lock serializes version creation, and at most one open draft exists per source; repeated requests return that draft.
   * - A requested base version must belong to the same source; only READY documents and their chunks are copied.
   * - Version identity is generated from the source slug and the next available ordinal; creation and audit commit together.
   *
   * Execution flow:
   * 1. Lock the source and return its existing DRAFT version when one is already open.
   * 2. Resolve the optional base version, choose an unused version label, and create a new DRAFT.
   * 3. Copy each READY base document and its chunks, then ensure a structural index when a base was supplied.
   * 4. Write the version-created audit event in the transaction and return the committed version detail.
   *
   * Failure cases:
   * - A missing source or a base version outside that source raises `sourceNotFound` with HTTP 404.
   * - Any copy, index, or audit failure rolls back the transaction; errors from the post-commit detail read propagate.
   *
   * Side effects:
   * - Creates the draft and copied source rows, derived chunks/index, and audit record inside a Prisma transaction.
   */
  async createVersion(input: {
    sourceId: string;
    actorId: string;
    correlationId: string;
    request: CreateLegalSourceVersionRequest;
  }): Promise<LegalSourceVersionDetail> {
    const versionId = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; slug: string }>>(
        Prisma.sql`SELECT id, slug FROM "LegalSource" WHERE id = ${input.sourceId} FOR UPDATE`,
      );
      if (!locked[0]) throw this.notFound(input.correlationId);
      const draft = await tx.legalSourceVersion.findFirst({
        where: {
          legalSourceId: input.sourceId,
          status: toPrismaLegalSourceLifecycleStatus(Lifecycle.draft),
        },
        select: { id: true },
      });
      if (draft) return draft.id;

      const base = input.request.basedOnVersionId
        ? await tx.legalSourceVersion.findFirst({
            where: {
              id: input.request.basedOnVersionId,
              legalSourceId: input.sourceId,
            },
            include: {
              documents: { include: { chunks: true } },
            },
          })
        : null;
      if (input.request.basedOnVersionId && !base) {
        throw this.notFound(input.correlationId);
      }

      const count = await tx.legalSourceVersion.count({
        where: { legalSourceId: input.sourceId },
      });
      let ordinal = count + 1;
      let label = `${locked[0].slug}.v${ordinal}`;
      while (
        await tx.legalSourceVersion.findUnique({
          where: { version: label },
          select: { id: true },
        })
      ) {
        ordinal += 1;
        label = `${locked[0].slug}.v${ordinal}`;
      }

      const created = await tx.legalSourceVersion.create({
        data: {
          legalSourceId: input.sourceId,
          version: label,
          status: toPrismaLegalSourceLifecycleStatus(Lifecycle.draft),
          sourceManifest: {
            managed: true,
            reviewRequired: false,
            basedOnVersionId: base?.id ?? null,
          },
          basedOnVersionId: base?.id ?? null,
          createdBy: input.actorId,
        },
      });

      for (const document of base?.documents ?? []) {
        if (
          document.ingestionState !==
          toPrismaLegalSourceDocumentIngestionState(States.READY)
        )
          continue;
        const copy = await tx.legalSourceDocument.create({
          data: {
            legalSourceVersionId: created.id,
            documentId: document.documentId,
            title: document.title,
            sourceUrl: document.sourceUrl,
            sourceSha256: document.sourceSha256,
            effectiveDate: document.effectiveDate,
            sourceEffectStatus: document.sourceEffectStatus,
            corpusRole: document.corpusRole,
            snapshotPath: document.snapshotPath,
            origin: document.origin,
            ingestionState: document.ingestionState,
            ingestionAttempt: document.ingestionAttempt,
            mediaType: document.mediaType,
            originalFileName: document.originalFileName,
            byteLength: document.byteLength,
            blobSha256: document.blobSha256,
            structureProfile: document.structureProfile,
            provenance: document.provenance ?? Prisma.DbNull,
            extraction: document.extraction ?? Prisma.DbNull,
            createdBy: input.actorId,
            ingestedAt: document.ingestedAt,
          },
        });
        await tx.legalDocumentChunk.createMany({
          data: document.chunks.map((chunk) => ({
            id: managedChunkId(created.id, document.documentId, chunk.locator),
            legalSourceVersionId: created.id,
            legalSourceDocumentId: copy.id,
            documentId: document.documentId,
            locator: chunk.locator,
            content: chunk.content,
            contentSha256: chunk.contentSha256,
            hierarchy: chunk.hierarchy as Prisma.InputJsonObject,
            legalStatus: chunk.legalStatus,
            legalEffectStatus: chunk.legalEffectStatus,
            legalStatusSourceRef: chunk.legalStatusSourceRef,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
          })),
        });
      }
      if (base) {
        await this.documents.ensureStructuralIndex(tx, {
          id: created.id,
          version: created.version,
          status: Lifecycle.draft,
        });
      }
      await this.audit.writeInTx(
        {
          eventType: "LEGAL_SOURCE_VERSION_CREATED",
          actorId: input.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.legalSourceVersion,
          resourceId: created.id,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          payload: {
            legalSourceId: input.sourceId,
            version: created.version,
            basedOnVersionId: base?.id ?? null,
          },
        },
        tx,
      );
      return created.id;
    });
    return this.getVersion(versionId, input.correlationId);
  }

  /**
   * Business purpose: Return one source version's document, readiness, index, and Rule Set Preparation reference details.
   *
   * Business rules:
   * - The requested version must have its parent legal source; persisted status values are translated at the Prisma boundary.
   * - The current structural-index revision is preferred; when absent, the newest stored retrieval index is shown.
   * - Rule Set and Preparation references both prevent a version from being presented as freely discardable.
   *
   * Execution flow:
   * 1. Load the version, parent source, and its retrieval-index history.
   * 2. Load documents, Rule Set count, and Preparation-run count concurrently.
   * 3. Select the matching or newest index and project the management detail.
   *
   * Failure cases:
   * - A missing version or parent source raises `sourceNotFound` with HTTP 404; database or mapping failures propagate.
   *
   * Side effects:
   * - None beyond read-only Prisma queries and in-memory view mapping.
   */
  async getVersion(
    versionId: string,
    correlationId: string,
  ): Promise<LegalSourceVersionDetail> {
    const version = await this.prisma.legalSourceVersion.findUnique({
      where: { id: versionId },
      include: {
        ...VERSION_INCLUDE,
        legalSource: { select: { id: true, slug: true, name: true } },
        retrievalIndexes: true,
      },
    });
    if (!version?.legalSource) throw this.notFound(correlationId);
    const [documents, ruleSetCount, preparationRuns] = await Promise.all([
      this.prisma.legalSourceDocument.findMany({
        where: { legalSourceVersionId: versionId },
        include: { _count: { select: { chunks: true } } },
      }),
      this.prisma.complianceRuleSetVersion.count({
        where: { legalSourceVersionId: versionId },
      }),
      this.prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: versionId },
      }),
    ]);
    const index =
      version.retrievalIndexes.find(
        (item) => item.version === structuralIndexVersion(version.version),
      ) ??
      [...version.retrievalIndexes].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0] ??
      null;
    return toVersionDetail({
      version,
      source: version.legalSource,
      documents,
      index,
      structuralValid: index?.status === LegalRetrievalIndexStatus.VALID,
      ruleSetCount: ruleSetCount + preparationRuns,
    });
  }

  /**
   * Business purpose: Promote a structurally valid draft into the active Legal Source Version used by downstream preparation and assessment.
   *
   * Business rules:
   * - An already ACTIVE version is idempotently returned; only a DRAFT can be newly activated.
   * - Every document must be READY, the version must contain documents, and its deterministic structural index must validate.
   * - The existing activation lifecycle supersedes the prior active version and starts preparation for this version; legal meaning is not decided here.
   *
   * Execution flow:
   * 1. Lock the requested version; return immediately from validation when it is already ACTIVE.
   * 2. Count READY documents, ensure the structural index, and reject any activation blockers.
   * 3. Pass the index integrity and retrieval validation references to the governed activation lifecycle.
   * 4. Reload and return the version detail after activation.
   *
   * Failure cases:
   * - A missing version raises `sourceNotFound`; a non-DRAFT immutable version raises `versionImmutable` with HTTP 409.
   * - Missing documents, incomplete ingestion, or invalid structure raises `versionNotReady` with HTTP 409 and blocker metadata.
   * - Index, activation lifecycle, and reload failures propagate without substituting a successful state.
   *
   * Side effects:
   * - May create a structural index and invokes the audited activation lifecycle, which changes active-version state and emits its governed preparation work.
   */
  async activate(input: {
    versionId: string;
    actorId: string;
    correlationId: string;
  }): Promise<LegalSourceVersionDetail> {
    const prepared = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; version: string }>
      >(
        Prisma.sql`SELECT id, status::text AS status, version FROM "LegalSourceVersion" WHERE id = ${input.versionId} FOR UPDATE`,
      );
      const version = rows[0];
      if (!version) throw this.notFound(input.correlationId);
      if (version.status === Lifecycle.active)
        return { alreadyActive: true as const };
      if (version.status !== Lifecycle.draft) {
        throw problemException(Errors.versionImmutable, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const documents = await tx.legalSourceDocument.findMany({
        where: { legalSourceVersionId: version.id },
        select: { ingestionState: true },
      });
      const ready = documents.filter(
        (document) =>
          document.ingestionState ===
          toPrismaLegalSourceDocumentIngestionState(States.READY),
      ).length;
      const index = await this.documents.ensureStructuralIndex(tx, version);
      const blockers = versionBlockers({
        status: Lifecycle.draft,
        documentCount: documents.length,
        readyDocumentCount: ready,
        structuralValid: index !== null,
      });
      if (blockers.length > 0 || !index) {
        throw problemException(Errors.versionNotReady, input.correlationId, {
          status: HttpStatus.CONFLICT,
          meta: {
            blockers: (blockers.length > 0
              ? blockers
              : [Blockers.INDEX_NOT_VALID]
            ).join(","),
          },
        });
      }
      return { alreadyActive: false as const, index };
    });

    if (!prepared.alreadyActive) {
      await this.legalSource.activateValidatedLegalSourceVersion({
        legalSourceVersionId: input.versionId,
        integrityManifestRef: structuralIntegrityRef(
          prepared.index.contentHash,
        ),
        retrievalValidationRef: prepared.index.validationRef,
        idempotencyKey: `admin-activate:${input.versionId}`,
        scopeDescription: "Activated by an administrator",
        comments: null,
        correlationId: input.correlationId,
        initiatingAdminActorId: input.actorId,
      });
    }
    return this.getVersion(input.versionId, input.correlationId);
  }

  /**
   * Business purpose: Discard an unused draft source version and its unreferenced derived and blob storage.
   *
   * Business rules:
   * - Only a DRAFT version can be discarded.
   * - Any Rule Set, Preparation run, or activation record reference makes the version immutable for discard.
   * - Shared source blobs are deleted only after the version is gone and no documents reference them.
   *
   * Execution flow:
   * 1. Lock the version and confirm that it remains DRAFT.
   * 2. Count durable Rule Set, Preparation, and activation references; reject a referenced version.
   * 3. Capture blob candidates, remove derived graph rows and the version, then delete newly orphaned blobs.
   * 4. Write the discard audit event in the same transaction.
   *
   * Failure cases:
   * - A missing version raises `sourceNotFound`; a non-draft version raises `versionImmutable`; referenced versions raise `versionInUse` (HTTP 409).
   * - Database, foreign-key, or audit failures roll back all transactional deletions.
   *
   * Side effects:
   * - Deletes draft/version graph data and any unreferenced blobs, and records `LEGAL_SOURCE_VERSION_DISCARDED` atomically.
   */
  async discard(input: {
    versionId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; legalSourceId: string | null }>
      >(
        Prisma.sql`SELECT id, status::text AS status, "legalSourceId" FROM "LegalSourceVersion" WHERE id = ${input.versionId} FOR UPDATE`,
      );
      const version = rows[0];
      if (!version) throw this.notFound(input.correlationId);
      if (version.status !== Lifecycle.draft) {
        throw problemException(Errors.versionImmutable, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const [ruleSets, runs, activations] = await Promise.all([
        tx.complianceRuleSetVersion.count({
          where: { legalSourceVersionId: version.id },
        }),
        tx.ruleSetPreparationRun.count({
          where: { legalSourceVersionId: version.id },
        }),
        tx.legalSourceActivationRecord.count({
          where: { legalSourceVersionId: version.id },
        }),
      ]);
      if (ruleSets + runs + activations > 0) {
        throw problemException(Errors.versionInUse, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const blobs = await tx.legalSourceDocument.findMany({
        where: { legalSourceVersionId: version.id },
        select: { blobSha256: true },
      });
      await discardDraftDocumentGraphs(tx, version.id);
      await tx.legalSourceVersion.delete({ where: { id: version.id } });
      const orphanCandidates = blobs
        .map((blob) => blob.blobSha256)
        .filter((sha): sha is string => sha !== null);
      if (orphanCandidates.length > 0) {
        await tx.legalSourceDocumentBlob.deleteMany({
          where: { sha256: { in: orphanCandidates }, documents: { none: {} } },
        });
      }
      await this.audit.writeInTx(
        {
          eventType: "LEGAL_SOURCE_VERSION_DISCARDED",
          actorId: input.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.legalSourceVersion,
          resourceId: version.id,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          payload: { legalSourceId: version.legalSourceId },
        },
        tx,
      );
    });
  }

  /**
   * Business purpose: Expose the active legal-source version and its document summary to customer-facing library views.
   *
   * Business rules:
   * - The active version is selected by ACTIVE status, preferring the latest activation and then creation timestamp.
   * - Only the active version's document summary fields are returned; draft metadata and raw contents are excluded.
   *
   * Execution flow:
   * 1. Load the latest active version and its source name.
   * 2. Load its documents in creation order and map the customer-facing document fields.
   * 3. Return the active version identity, activation time, and document summaries.
   *
   * Failure cases:
   * - When no active version exists, raise `sourceNotFound` with HTTP 404.
   * - Database read or projection errors propagate; an absent related source name falls back to the stored version label.
   *
   * Side effects:
   * - None beyond read-only Prisma access and in-memory projection.
   */
  async getActiveLibrary(correlationId: string): Promise<ActiveLegalLibrary> {
    const version = await this.prisma.legalSourceVersion.findFirst({
      where: { status: toPrismaLegalSourceLifecycleStatus(Lifecycle.active) },
      orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
      include: { legalSource: { select: { name: true } } },
    });
    if (!version) {
      throw problemException(Errors.sourceNotFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    const documents = await this.prisma.legalSourceDocument.findMany({
      where: { legalSourceVersionId: version.id },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: "asc" },
    });
    return {
      versionId: version.id,
      version: version.version,
      sourceName: version.legalSource?.name ?? version.version,
      activatedAt: version.activatedAt?.toISOString() ?? null,
      documents: documents.map((document) => {
        const view = toDocumentView(document, false);
        return {
          id: view.id,
          documentId: view.documentId,
          title: view.title,
          sourceUrl: view.sourceUrl,
          sourceEffectStatus: view.sourceEffectStatus,
          effectiveDate: view.effectiveDate,
          chunkCount: view.chunkCount,
          mediaType: view.mediaType,
          hasOriginal: view.hasOriginal,
        };
      }),
    };
  }

  /**
   * Business purpose: Create the standard not-found problem for legal-source management lookups.
   *
   * Business rules:
   * - Every missing-source/version response uses the shared `sourceNotFound` code and HTTP 404 status.
   * - An absent correlation identifier receives a generated identifier so the problem remains traceable.
   *
   * Execution flow:
   * 1. Use the supplied correlation identifier when present, otherwise generate a UUID.
   * 2. Build the shared legal-source not-found problem exception.
   *
   * Failure cases:
   * - The helper does not catch problem-factory failures; they propagate to the HTTP boundary.
   *
   * Side effects:
   * - None: it constructs an exception and does not read or write legal-source records.
   */
  private notFound(correlationId: string) {
    return problemException(
      Errors.sourceNotFound,
      correlationId || randomUUID(),
      {
        status: HttpStatus.NOT_FOUND,
      },
    );
  }
}
