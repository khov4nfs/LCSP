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

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

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

  async listSources(): Promise<LegalSourceList> {
    const sources = await this.prisma.legalSource.findMany({
      orderBy: { createdAt: "asc" },
      include: { versions: { include: VERSION_INCLUDE } },
    });
    return { items: sources.map(toSourceSummary) };
  }

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
   * Starts the next draft version of a source, optionally from the documents of an earlier
   * version. One open draft per source: asking again returns it instead of creating another.
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
   * Makes a validated draft the active Legal Source Version. The platform has one active version:
   * the previous one is superseded atomically by the existing activation lifecycle, which also
   * starts the Rule Set Preparation for the new version. No review gate: the deterministic
   * validation of the stored content is the quality control.
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

  /** Deletes an unreferenced draft. Anything a rule set or Preparation run points at stays forever. */
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

  /** The customer-facing view: the one active Legal Source Version and its documents. */
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
