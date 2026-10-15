import { createHash, randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { isRecord } from "@lcsp/contracts/shared";
import {
  ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES,
  ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_TOOL,
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_STATUSES,
} from "@lcsp/contracts/evidence";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  LEGAL_SOURCE_TRUST_POLICIES,
  LEGAL_SOURCE_EVENT_TYPES,
  LEGAL_SOURCE_ERROR_CODES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-source";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { LegalRetrievalIndexStatus, Prisma } from "@prisma/client";

export async function acquireLegalSourceLifecycleLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (typeof tx.$queryRaw !== "function") return;
  let acquired = false;
  while (!acquired) {
    const result = await tx.$queryRaw<Array<{ acquired: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext('lcsp:legal-source-lifecycle')) AS acquired`,
    );
    acquired = result[0]?.acquired === true;
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

import { toPrismaLegalSourceLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import type {
  IngestLegalSourceRequest,
  LegalSourceDocumentInput,
} from "../contracts/legal-source.contract.js";

const SAFE_MANIFEST_REF = /^[a-z][a-z0-9-]{0,63}:[A-Za-z0-9._:-]{1,180}$/;
const LEGAL_SOURCE_ACTIVATION_SERVICE = "legal-source-activation-service";
const LEGAL_SOURCE_CHANGE_MODES = {
  fullBuild: "FULL_BUILD",
  partialUpdate: "PARTIAL_UPDATE",
  noChanges: "NO_CHANGES",
} as const;

@Injectable()
export class LegalSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async ingestDraft(input: IngestLegalSourceRequest) {
    const selectedInput = this.selectDatabaseLegalChunks(input);
    this.validateIngest(selectedInput);
    const changeSet = await this.detectLegalSourceChanges(selectedInput);
    if (changeSet.mode === LEGAL_SOURCE_CHANGE_MODES.noChanges) {
      return {
        id: changeSet.baseLegalSourceVersionId,
        version: changeSet.baseLegalSourceVersion,
        status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        documentCount: selectedInput.documents.length,
        chunkCount: selectedInput.documents.reduce(
          (count, document) => count + document.chunks.length,
          0,
        ),
        noChanges: true,
        changeSet,
      };
    }

    const existing = await this.prisma.legalSourceVersion.findUnique({
      where: { version: selectedInput.version },
      select: {
        id: true,
        status: true,
        _count: { select: { documents: true } },
      },
    });
    const canHydratePreparation =
      existing?.status ===
        toPrismaLegalSourceLifecycleStatus(
          LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
        ) && existing._count.documents === 0;
    if (existing && !canHydratePreparation) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        "legal-source-ingest",
        {
          status: HttpStatus.CONFLICT,
          meta: { version: selectedInput.version },
        },
      );
    }

    // Capture ingestion provenance metadata
    const ingestionRunId = selectedInput.ingestionRunId || randomUUID();
    const retrievedAt = selectedInput.retrievedAt
      ? new Date(selectedInput.retrievedAt)
      : new Date();
    const enrichedManifest = {
      ...selectedInput.sourceManifest,
      ingestionMetadata: {
        ingestionRunId,
        retrievedAt: retrievedAt.toISOString(),
        importedAt: new Date().toISOString(),
      },
      changeSet,
    };

    return this.prisma.$transaction(async (tx) => {
      const legalSource = canHydratePreparation
        ? await tx.legalSourceVersion.update({
            where: { id: existing.id },
            data: { sourceManifest: enrichedManifest },
          })
        : await tx.legalSourceVersion.create({
            data: {
              version: selectedInput.version,
              sourceManifest: enrichedManifest,
              status: toPrismaLegalSourceLifecycleStatus(
                LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
              ),
            },
          });

      for (const document of selectedInput.documents) {
        await this.createDocument(tx, legalSource.id, document);
      }

      return {
        id: legalSource.id,
        version: legalSource.version,
        status: LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
        documentCount: selectedInput.documents.length,
        chunkCount: selectedInput.documents.reduce(
          (count, document) => count + document.chunks.length,
          0,
        ),
        noChanges: false,
        changeSet,
      };
    });
  }

  async activateValidatedLegalSourceVersion(input: {
    legalSourceVersionId: string;
    integrityManifestRef: string;
    retrievalValidationRef: string;
    idempotencyKey: string;
    scopeDescription: string;
    comments: string | null;
    correlationId: string;
    initiatingAdminActorId?: string;
  }) {
    this.validateActivationInput(input);

    const replay = await this.prisma.legalSourceActivationRecord.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { legalSourceVersion: true },
    });
    if (replay) {
      if (replay.legalSourceVersionId !== input.legalSourceVersionId) {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.legalSourceVersionAlreadyActivated,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: {
              reason:
                ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES.activationReplayConflict,
            },
          },
        );
      }
      return this.toActivationResponse(
        replay.legalSourceVersion.id,
        replay.legalSourceVersion.version,
        input.correlationId,
        replay.id,
        replay.outboxEventId ?? "",
      );
    }

    const legalSource = await this.prisma.legalSourceVersion.findUnique({
      where: { id: input.legalSourceVersionId },
      include: {
        documents: { include: { chunks: true } },
        retrievalIndexes: {
          orderBy: [{ validatedAt: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!legalSource) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      legalSource.status !==
      toPrismaLegalSourceLifecycleStatus(LEGAL_SOURCE_LIFECYCLE_STATUSES.draft)
    ) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceVersionAlreadyActivated,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: {
            reason:
              ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES.legalSourceVersionNotDraft,
          },
        },
      );
    }
    if (
      legalSource.documents.length === 0 ||
      legalSource.documents.some((document) => document.chunks.length === 0)
    ) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const retrievalIndex = legalSource.retrievalIndexes.find(
      (index) => index.validationManifestRef === input.retrievalValidationRef,
    );
    if (!retrievalIndex) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES.retrievalValidationMissing,
          },
        },
      );
    }
    if (retrievalIndex.status !== "VALID" || !retrievalIndex.validatedAt) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES.retrievalIndexNotValid,
          },
        },
      );
    }

    const activatedAt = new Date();
    let activationRecordId = "";
    let outboxEventId = "";
    await this.prisma.$transaction(
      async (tx) => {
        await acquireLegalSourceLifecycleLock(tx);
        const claimed = await tx.legalSourceVersion.updateMany({
          where: {
            id: legalSource.id,
            status: toPrismaLegalSourceLifecycleStatus(
              LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
            ),
          },
          data: {
            status: toPrismaLegalSourceLifecycleStatus(
              LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
            ),
            activatedAt,
            integrityManifestRef: input.integrityManifestRef,
          },
        });
        if (claimed.count !== 1) {
          throw problemException(
            LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
            input.correlationId,
            {
              status: HttpStatus.CONFLICT,
              meta: { reason: "LEGAL_SOURCE_NOT_DRAFT" },
            },
          );
        }
        const previousActive =
          typeof tx.legalSourceVersion.findFirst === "function"
            ? await tx.legalSourceVersion.findFirst({
                where: {
                  id: { not: legalSource.id },
                  status: toPrismaLegalSourceLifecycleStatus(
                    LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
                  ),
                },
                select: { id: true },
              })
            : null;
        const superseded = await tx.legalSourceVersion.updateMany({
          where: {
            id: { not: legalSource.id },
            status: toPrismaLegalSourceLifecycleStatus(
              LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
            ),
          },
          data: {
            status: toPrismaLegalSourceLifecycleStatus(
              LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded,
            ),
          },
        });

        const activation = await tx.legalSourceActivationRecord.create({
          data: {
            legalSourceVersionId: legalSource.id,
            activatedBy: LEGAL_SOURCE_ACTIVATION_SERVICE,
            status: toPrismaLegalSourceLifecycleStatus(
              LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
            ),
            idempotencyKey: input.idempotencyKey,
            integrityManifestRef: input.integrityManifestRef,
            retrievalValidationRef: input.retrievalValidationRef,
            scopeDescription: input.scopeDescription,
            comments: input.comments,
            activatedAt: activatedAt,
          },
        });
        activationRecordId = activation.id;

        const outboxEvent = buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.legalSourceVersion,
          aggregateId: legalSource.id,
          eventType: LEGAL_SOURCE_EVENT_TYPES.legalSourceVersionActivated,
          correlationId: input.correlationId,
          causationId: activation.id,
          actor: {
            id: LEGAL_SOURCE_ACTIVATION_SERVICE,
            type: AUDIT_ACTOR_TYPES.system,
          },
          result: AGENTIC_TOOL_STATUSES.ready,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${legalSource.id}:${input.idempotencyKey}:activation`,
          payload: {
            legalSourceVersionRef: `legal-source-version:${legalSource.id}`,
            legalSourceVersionId: legalSource.id,
            activationRecordRef: `legal-source-activation:${activation.id}`,
            integrityManifestRef: input.integrityManifestRef,
            retrievalValidationRef: input.retrievalValidationRef,
            supersededApprovedCount: superseded.count,
          },
        });
        outboxEventId = await this.outboxRepository.enqueue(outboxEvent, tx);
        await tx.legalSourceActivationRecord.update({
          where: { id: activation.id },
          data: { outboxEventId },
        });

        await this.auditWriter.writeInTx(
          {
            eventType: LEGAL_SOURCE_EVENT_TYPES.legalSourceVersionActivated,
            actorId: LEGAL_SOURCE_ACTIVATION_SERVICE,
            actor: {
              id: LEGAL_SOURCE_ACTIVATION_SERVICE,
              type: AUDIT_ACTOR_TYPES.system,
            },
            resourceType: AUDIT_RESOURCE_TYPES.legalSourceVersion,
            resourceId: legalSource.id,
            decision: AUDIT_DECISIONS.allow,
            correlationId: input.correlationId,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            payload: {
              toolName: ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_TOOL.name,
              legalSourceVersionRef: `legal-source-version:${legalSource.id}`,
              activationRecordRef: `legal-source-activation:${activation.id}`,
              outboxEventRef: `outbox:${outboxEventId}`,
              integrityManifestRef: input.integrityManifestRef,
              retrievalValidationRef: input.retrievalValidationRef,
              manualApprovalRequired: false,
              idempotencyKey: input.idempotencyKey,
            },
          },
          tx,
        );

        if (input.initiatingAdminActorId) {
          await this.auditWriter.writeInTx(
            {
              eventType: LEGAL_SOURCE_EVENT_TYPES.legalSourceVersionActivated,
              actorId: input.initiatingAdminActorId,
              actor: {
                id: input.initiatingAdminActorId,
                type: AUDIT_ACTOR_TYPES.user,
              },
              resourceType: AUDIT_RESOURCE_TYPES.legalSourceVersion,
              resourceId: legalSource.id,
              decision: AUDIT_DECISIONS.allow,
              correlationId: input.correlationId,
              redactionStatus: AUDIT_REDACTION_STATUSES.none,
              payload: {
                targetVersionId: legalSource.id,
                previousActiveVersionId: previousActive?.id ?? null,
                activationRecordRef: `legal-source-activation:${activation.id}`,
                outboxEventRef: `outbox:${outboxEventId}`,
                integrityManifestRef: input.integrityManifestRef,
                retrievalValidationRef: input.retrievalValidationRef,
                idempotencyKey: input.idempotencyKey,
                result: AGENTIC_TOOL_STATUSES.ready,
              },
            },
            tx,
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toActivationResponse(
      legalSource.id,
      legalSource.version,
      input.correlationId,
      activationRecordId,
      outboxEventId,
    );
  }

  async registerValidatedRetrievalIndex(input: {
    legalSourceVersionId: string;
    version: string;
    configHash: string;
    contentHash: string;
    validationManifestRef: string;
    validatedAt?: string | null;
    correlationId: string;
  }) {
    this.validateRetrievalIndexInput(input);

    const legalSource = await this.prisma.legalSourceVersion.findUnique({
      where: { id: input.legalSourceVersionId },
      select: { id: true, version: true },
    });
    if (!legalSource) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const existing = await this.prisma.legalRetrievalIndex.findUnique({
      where: { version: input.version },
      select: {
        id: true,
        legalSourceVersionId: true,
        version: true,
        status: true,
        validationManifestRef: true,
      },
    });
    if (existing) {
      if (
        existing.legalSourceVersionId !== input.legalSourceVersionId ||
        existing.validationManifestRef !== input.validationManifestRef
      ) {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: { reason: "retrieval_index_version_conflict" },
          },
        );
      }
      return {
        id: existing.id,
        version: existing.version,
        status: existing.status,
        validationManifestRef: existing.validationManifestRef,
      };
    }

    const index = await this.prisma.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId: input.legalSourceVersionId,
        version: input.version,
        status: LegalRetrievalIndexStatus.VALID,
        configHash: input.configHash,
        contentHash: input.contentHash,
        validationManifestRef: input.validationManifestRef,
        validatedAt: input.validatedAt
          ? new Date(input.validatedAt)
          : new Date(),
      },
    });

    return {
      id: index.id,
      version: index.version,
      status: index.status,
      validationManifestRef: index.validationManifestRef,
    };
  }

  private validateActivationInput(input: {
    integrityManifestRef: string;
    retrievalValidationRef: string;
    idempotencyKey: string;
    correlationId: string;
  }): void {
    if (!SAFE_MANIFEST_REF.test(input.integrityManifestRef)) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES.integrityManifestInvalid,
          },
        },
      );
    }
    if (!SAFE_MANIFEST_REF.test(input.retrievalValidationRef)) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES.retrievalValidationMismatch,
          },
        },
      );
    }
    if (!input.idempotencyKey.trim()) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { reason: "idempotency_key_required" },
        },
      );
    }
  }

  private validateRetrievalIndexInput(input: {
    version: string;
    configHash: string;
    contentHash: string;
    validationManifestRef: string;
    validatedAt?: string | null;
    correlationId: string;
  }): void {
    const valid =
      Boolean(input.version.trim()) &&
      isSha256(input.configHash) &&
      isSha256(input.contentHash) &&
      SAFE_MANIFEST_REF.test(input.validationManifestRef) &&
      (!input.validatedAt || !Number.isNaN(Date.parse(input.validatedAt)));
    if (!valid) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { reason: "retrieval_index_validation_manifest_invalid" },
        },
      );
    }
  }

  private toActivationResponse(
    legalSourceId: string,
    version: string,
    correlationId: string,
    activationRecordId: string,
    outboxEventId: string,
  ) {
    return {
      id: legalSourceId,
      version,
      status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
      correlationId,
      toolName: ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_TOOL.name,
      toolVersion: ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_TOOL.version,
      configHash: ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_TOOL.configHash,
      artifactVersions: { legalSourceVersionId: legalSourceId },
      provenanceRef: `tool-execution:${correlationId}`,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: [
        `legal-source-activation:${activationRecordId}`,
        `outbox:${outboxEventId}`,
      ],
      limitations: [],
      result: {
        activeLegalSourceVersionRef: `legal-source-version:${legalSourceId}`,
        lifecycleStatus: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        activationRecordRef: `legal-source-activation:${activationRecordId}`,
        outboxEventRef: `outbox:${outboxEventId}`,
        systemActor: LEGAL_SOURCE_ACTIVATION_SERVICE,
        manualApprovalRequired: false,
      },
    };
  }

  async getActiveChunks(legalSourceVersionId: string) {
    const legalSource = await this.prisma.legalSourceVersion.findFirst({
      where: {
        id: legalSourceVersionId,
        status: toPrismaLegalSourceLifecycleStatus(
          LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        ),
      },
      include: { chunks: { orderBy: { id: "asc" } } },
    });
    if (!legalSource) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.activeLegalSourceNotFound,
        "legal-source-chunks",
        { status: HttpStatus.NOT_FOUND },
      );
    }
    return {
      versionId: legalSource.id,
      version: legalSource.version,
      chunks: legalSource.chunks.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        locator: chunk.locator,
        content: chunk.content,
        contentSha256: chunk.contentSha256,
        hierarchy: chunk.hierarchy,
        legalStatus: chunk.legalStatus,
        legalEffectStatus: chunk.legalEffectStatus,
        legalStatusSourceRef: chunk.legalStatusSourceRef,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
      })),
    };
  }

  private async detectLegalSourceChanges(input: IngestLegalSourceRequest) {
    const base = await this.prisma.legalSourceVersion.findFirst({
      where: {
        status: toPrismaLegalSourceLifecycleStatus(
          LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        ),
        activatedAt: { not: null },
      },
      orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        documents: true,
        chunks: true,
      },
    });
    const currentDocuments = new Map(
      input.documents.map((document) => [document.documentId, document]),
    );
    const currentChunks = new Map(
      input.documents.flatMap((document) =>
        document.chunks.map((chunk) => [chunk.id, chunk] as const),
      ),
    );
    const currentChunkDocumentIds = new Map(
      input.documents.flatMap((document) =>
        document.chunks.map(
          (chunk) => [chunk.id, document.documentId] as const,
        ),
      ),
    );
    if (!base) {
      return {
        mode: LEGAL_SOURCE_CHANGE_MODES.fullBuild,
        baseLegalSourceVersionId: null,
        baseLegalSourceVersion: null,
        changedDocumentIds: [...currentDocuments.keys()].sort(),
        addedDocumentIds: [...currentDocuments.keys()].sort(),
        removedDocumentIds: [],
        unchangedDocumentIds: [],
        changedChunkIds: [...currentChunks.keys()].sort(),
        addedChunkIds: [...currentChunks.keys()].sort(),
        removedChunkIds: [],
        unchangedChunkIds: [],
      };
    }

    const baseDocuments = new Map(
      base.documents.map((document) => [document.documentId, document]),
    );
    const baseChunks = new Map(base.chunks.map((chunk) => [chunk.id, chunk]));
    const addedDocumentIds: string[] = [];
    const changedDocumentIds: string[] = [];
    const unchangedDocumentIds: string[] = [];
    for (const [documentId, document] of currentDocuments) {
      const previous = baseDocuments.get(documentId);
      if (!previous) {
        addedDocumentIds.push(documentId);
      } else if (previous.sourceSha256 !== document.sourceSha256) {
        changedDocumentIds.push(documentId);
      } else {
        unchangedDocumentIds.push(documentId);
      }
    }
    const removedDocumentIds = [...baseDocuments.keys()].filter(
      (documentId) => !currentDocuments.has(documentId),
    );

    const addedChunkIds: string[] = [];
    const changedChunkIds: string[] = [];
    const unchangedChunkIds: string[] = [];
    const chunkAffectedDocumentIds = new Set<string>();
    for (const [chunkId, chunk] of currentChunks) {
      const previous = baseChunks.get(chunkId);
      if (!previous) {
        addedChunkIds.push(chunkId);
        chunkAffectedDocumentIds.add(
          currentChunkDocumentIds.get(chunkId) ?? "",
        );
      } else if (previous.contentSha256 !== chunk.contentSha256) {
        changedChunkIds.push(chunkId);
        chunkAffectedDocumentIds.add(
          currentChunkDocumentIds.get(chunkId) ?? "",
        );
      } else {
        unchangedChunkIds.push(chunkId);
      }
    }
    const removedChunkIds = [...baseChunks.keys()].filter(
      (chunkId) => !currentChunks.has(chunkId),
    );
    for (const chunkId of removedChunkIds) {
      const previous = baseChunks.get(chunkId);
      if (previous) {
        chunkAffectedDocumentIds.add(previous.documentId);
      }
    }
    const affectedChunkIds = [
      ...new Set([...addedChunkIds, ...changedChunkIds, ...removedChunkIds]),
    ].sort();
    const affectedDocumentIds = [
      ...new Set([
        ...addedDocumentIds,
        ...changedDocumentIds,
        ...removedDocumentIds,
        ...[...chunkAffectedDocumentIds].filter(Boolean),
      ]),
    ].sort();
    return {
      mode:
        affectedChunkIds.length === 0 && affectedDocumentIds.length === 0
          ? LEGAL_SOURCE_CHANGE_MODES.noChanges
          : LEGAL_SOURCE_CHANGE_MODES.partialUpdate,
      baseLegalSourceVersionId: base.id,
      baseLegalSourceVersion: base.version,
      changedDocumentIds: affectedDocumentIds,
      addedDocumentIds: addedDocumentIds.sort(),
      removedDocumentIds: removedDocumentIds.sort(),
      unchangedDocumentIds: unchangedDocumentIds.sort(),
      changedChunkIds: affectedChunkIds,
      addedChunkIds: addedChunkIds.sort(),
      removedChunkIds: removedChunkIds.sort(),
      unchangedChunkIds: unchangedChunkIds.sort(),
    };
  }

  private async createDocument(
    tx: Prisma.TransactionClient,
    legalSourceVersionId: string,
    document: LegalSourceDocumentInput,
  ): Promise<void> {
    const sourceDocument = await tx.legalSourceDocument.create({
      data: {
        legalSourceVersionId,
        documentId: document.documentId,
        title: document.title,
        sourceUrl: document.sourceUrl,
        sourceSha256: document.sourceSha256,
        sourceEffectStatus: document.sourceEffectStatus,
        effectiveDate: document.effectiveDate
          ? new Date(document.effectiveDate)
          : null,
        snapshotPath: document.snapshotPath ?? null,
      },
    });
    await tx.legalDocumentChunk.createMany({
      data: document.chunks.map((chunk) => ({
        id: chunk.id,
        legalSourceVersionId,
        legalSourceDocumentId: sourceDocument.id,
        documentId: document.documentId,
        locator: chunk.locator,
        content: chunk.content,
        contentSha256: chunk.contentSha256,
        hierarchy: chunk.hierarchy as Prisma.InputJsonValue,
        legalStatus: chunk.legalStatus,
        pageStart: chunk.pageStart ?? null,
        pageEnd: chunk.pageEnd ?? null,
      })),
    });
  }

  /**
   * Structural gate only: empty chunks, formal headings and law preambles are not retrievable
   * law. Whether a provision imposes a duty is the Rule Set Preparation agent's interpretation,
   * never a term list here.
   */
  private selectDatabaseLegalChunks(
    input: IngestLegalSourceRequest,
  ): IngestLegalSourceRequest {
    return {
      ...input,
      sourceManifest: {
        ...input.sourceManifest,
        chunkSelectionPolicy:
          "Persist only hierarchy-addressable legal chunks; exclude formal headers/preamble. No semantic classification is applied.",
      },
      documents: input.documents.map((document) => ({
        ...document,
        chunks: (Array.isArray(document.chunks) ? document.chunks : []).filter(
          (chunk) => isLegalDatabaseChunk(chunk.content),
        ),
      })),
    };
  }

  private validateIngest(input: IngestLegalSourceRequest): void {
    const valid =
      Boolean(input.version?.trim()) &&
      Array.isArray(input.documents) &&
      input.documents.length > 0 &&
      input.documents.every(
        (document) =>
          Boolean(document.documentId?.trim()) &&
          Boolean(document.title?.trim()) &&
          Boolean(document.sourceUrl?.trim()) &&
          isSha256(document.sourceSha256) &&
          Array.isArray(document.chunks) &&
          document.chunks.length > 0 &&
          document.chunks.every(
            (chunk) =>
              Boolean(chunk.id?.trim()) &&
              Boolean(chunk.locator?.trim()) &&
              Boolean(chunk.content?.trim()) &&
              isSha256(chunk.contentSha256) &&
              hash(chunk.content) === chunk.contentSha256,
          ),
      );
    if (!valid) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        "legal-source-ingest",
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    this.requireOfficialSourceAutoTrust(
      input.sourceManifest,
      "legal-source-ingest",
    );
  }

  /**
   * Source ingestion is trusted only through the mechanical official-source gate (hashes,
   * hierarchy, retrieval index). No person signs a legalSource or any LegalRequirement off.
   */
  private requireOfficialSourceAutoTrust(
    sourceManifest: unknown,
    correlationId: string,
  ): void {
    if (
      isRecord(sourceManifest) &&
      sourceManifest.reviewRequired === false &&
      sourceManifest.trustPolicy ===
        LEGAL_SOURCE_TRUST_POLICIES.officialSourceAutoTrusted
    ) {
      return;
    }
    throw problemException(
      LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
      correlationId,
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        meta: { reason: "official_source_auto_trust_required" },
      },
    );
  }
}

function hash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/i.test(value);
}

function isLegalDatabaseChunk(content: string): boolean {
  return (
    content.trim().length > 0 &&
    !isLegalHeadingOnly(content) &&
    !isLegalPreambleOnly(content)
  );
}

function isLegalHeadingOnly(content: string): boolean {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length === 1 && /^chương\s+[ivxlc0-9]+\b.*$/iu.test(lines[0]);
}

function isLegalPreambleOnly(content: string): boolean {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;
  if (
    lines.some((line) => line.toLocaleLowerCase("vi-VN").startsWith("điều "))
  ) {
    return false;
  }
  return /quốc hội|cộng hòa xã hội chủ nghĩa việt nam|độc lập\s*-\s*tự do|luật số|căn cứ hiến pháp|quốc hội ban hành|chủ tịch quốc hội/iu.test(
    lines.join(" "),
  );
}
