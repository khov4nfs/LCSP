import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import {
  CORPUS_VERSION_READINESS_CHECKS,
  CORPUS_VERSION_READINESS_STATES,
  CORPUS_PREPARATION_STATUSES,
  CORPUS_VERSION_SNAPSHOT_CATEGORIES,
  CORPUS_VERSION_PRESENTATION_STATUSES,
  CORPUS_VERSION_PUBLICATION_STATES,
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_EVENT_TYPES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
  type AdminCorpusVersionDetail,
  type AdminCorpusVersionSummary,
  type CorpusVersionReadinessState,
  type CorpusPreparationTerminalStatus,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { Prisma } from "@prisma/client";

import {
  fromPrismaLegalRuleLifecycleStatus,
  toPrismaLegalRuleLifecycleStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  acquireLegalCorpusLifecycleLock,
  LegalCorpusService,
} from "./legal-corpus.service.js";

@Injectable()
export class AdminCorpusVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    @Optional() private readonly legalCorpus?: LegalCorpusService,
    private readonly outbox: OutboxRepository = undefined as never,
  ) {}

  async list(input: { page?: number; pageSize?: number } = {}) {
    const requestedPage = Number.isFinite(input.page) ? input.page! : 1;
    const requestedPageSize = Number.isFinite(input.pageSize)
      ? input.pageSize!
      : 20;
    const page = Math.max(1, Math.floor(requestedPage));
    const pageSize = Math.min(100, Math.max(1, Math.floor(requestedPageSize)));
    const [total, active, draft, versions] = await Promise.all([
      this.prisma.legalCorpusVersion.count(),
      this.prisma.legalCorpusVersion.findFirst({
        where: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        },
        orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
        include: { _count: { select: { documents: true } } },
      }),
      this.prisma.legalCorpusVersion.findFirst({
        where: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.draft,
          ),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
      this.prisma.legalCorpusVersion.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { documents: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const activeId = active?.id ?? null;
    const summaries = versions.map((version) =>
      this.summary(version, version.id === activeId),
    );
    return {
      currentActive: active ? this.summary(active, true) : null,
      items: summaries,
      pagination: { page, pageSize, total, hasNext: page * pageSize < total },
      canCreate: draft === null,
      ...(draft
        ? { createUnavailableReason: "CORPUS_PREPARATION_IN_PROGRESS" as const }
        : {}),
    };
  }

  async prepare(input: {
    actorId: string;
    idempotencyKey: string;
    correlationId: string;
  }) {
    if (!this.outbox) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          meta: { reason: "CORPUS_PREPARATION_WORKFLOW_UNAVAILABLE" },
        },
      );
    }
    if (!input.idempotencyKey.trim()) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const outbox = this.outbox;
    const existing = await this.prisma.corpusPreparation.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing)
      return {
        id: existing.id,
        corpusVersionId: existing.targetCorpusId,
        status: existing.status,
        idempotentReplay: true,
      };
    const active = await this.prisma.legalCorpusVersion.findFirst({
      where: { status: { in: ["DRAFT", "APPROVED"] } },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      include: {
        documents: {
          select: {
            documentId: true,
            sourceUrl: true,
            sourceEffectStatus: true,
          },
        },
      },
    });
    if (active?.status === "DRAFT") {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: { reason: "CORPUS_PREPARATION_IN_PROGRESS" },
        },
      );
    }
    const base = active?.status === "APPROVED" ? active : null;
    const sourceCrawlRequests = base
      ? await this.resolvePreparationSources(base.documents)
      : [];
    const targetVersion = `ADMIN-PREP-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${input.idempotencyKey.slice(0, 8)}`;
    return this.prisma.$transaction(
      async (tx) => {
        if (typeof tx.$queryRaw === "function") {
          let lockAcquired = false;
          while (!lockAcquired) {
            const lockResult = await tx.$queryRaw<Array<{ acquired: boolean }>>(
              Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext('lcsp:admin-corpus-preparation')) AS acquired`,
            );
            lockAcquired = lockResult[0]?.acquired === true;
            if (!lockAcquired)
              await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        const existingPreparation = await tx.corpusPreparation.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existingPreparation) {
          return {
            id: existingPreparation.id,
            corpusVersionId: existingPreparation.targetCorpusId,
            status: existingPreparation.status,
            idempotentReplay: true,
          };
        }
        const draft = await tx.legalCorpusVersion.findFirst({
          where: {
            status: toPrismaLegalRuleLifecycleStatus(
              LEGAL_RULE_LIFECYCLE_STATUSES.draft,
            ),
          },
          select: { id: true },
        });
        if (draft) {
          throw problemException(
            LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
            input.correlationId,
            {
              status: HttpStatus.CONFLICT,
              meta: { reason: "CORPUS_PREPARATION_IN_PROGRESS" },
            },
          );
        }
        const target = await tx.legalCorpusVersion.create({
          data: {
            version: targetVersion,
            sourceManifest: {
              preparation: {
                state: "REQUESTED",
                baseCorpusVersionId: base?.id ?? null,
              },
            },
            status: "DRAFT",
          },
        });
        const preparation = await tx.corpusPreparation.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            targetCorpusId: target.id,
            baseCorpusId: base?.id ?? null,
            requestedBy: input.actorId,
            correlationId: input.correlationId,
          },
        });
        await outbox.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.legalCorpusVersion,
            aggregateId: target.id,
            eventType: LEGAL_RULE_EVENT_TYPES.corpusPreparationRequested,
            correlationId: input.correlationId,
            causationId: preparation.id,
            actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
            result: "REQUESTED",
            idempotencyKey: input.idempotencyKey,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            payload: {
              preparationId: preparation.id,
              targetCorpusVersionId: target.id,
              targetVersion,
              deferActivation: true,
              baseCorpusVersionId: base?.id ?? null,
              sourceCrawlRequests,
            },
          }),
          tx,
        );
        await this.auditWriter.writeInTx(
          {
            eventType: LEGAL_RULE_EVENT_TYPES.corpusPreparationRequested,
            actorId: input.actorId,
            actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
            resourceType: AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion,
            resourceId: target.id,
            decision: AUDIT_DECISIONS.allow,
            correlationId: input.correlationId,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            payload: {
              preparationId: preparation.id,
              baseCorpusVersionId: base?.id ?? null,
            },
          },
          tx,
        );
        return {
          id: preparation.id,
          corpusVersionId: target.id,
          status: preparation.status,
          idempotentReplay: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async resolvePreparationSources(
    documents:
      | Array<{
          documentId: string;
          sourceUrl: string;
          sourceEffectStatus: string;
        }>
      | undefined,
  ) {
    if (!Array.isArray(documents)) return [];
    if (
      !documents.length ||
      typeof this.prisma.legalSourceSnapshot?.findMany !== "function"
    )
      return [];
    const snapshots = await this.prisma.legalSourceSnapshot.findMany({
      where: {
        documentId: { in: documents.map((document) => document.documentId) },
      },
      orderBy: { createdAt: "desc" },
    });
    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots)
      if (!latest.has(snapshot.documentId))
        latest.set(snapshot.documentId, snapshot);
    return documents.flatMap((document) => {
      const snapshot = latest.get(document.documentId);
      if (!snapshot?.catalogSourceRef) {
        const inferred = inferGovernedSourceRequest(document);
        return inferred ? [inferred] : [];
      }
      return [
        {
          documentId: document.documentId,
          catalogSourceRef: snapshot.catalogSourceRef,
          sourceUrl: snapshot.sourceUrl || document.sourceUrl,
          gatewayDocumentId: snapshot.documentId,
          sourceEffectStatus:
            snapshot.sourceEffectStatus || document.sourceEffectStatus,
          expectedDocumentNumber: snapshot.documentNumber,
        },
      ];
    });
  }

  async completePreparation(input: {
    preparationId: string;
    corpusVersionId: string;
    status: CorpusPreparationTerminalStatus;
    readiness?: Record<string, string>;
    integrityManifestRef?: string | null;
    retrievalValidationRef?: string | null;
    errorCode?: string | null;
    correlationId: string;
  }) {
    const preparation = await this.prisma.corpusPreparation.findUnique({
      where: { id: input.preparationId },
    });
    if (!preparation || preparation.targetCorpusId !== input.corpusVersionId) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.corpusPreparation.updateMany({
        where: {
          id: input.preparationId,
          status: {
            in: [
              CORPUS_PREPARATION_STATUSES.requested,
              CORPUS_PREPARATION_STATUSES.running,
            ],
          },
        },
        data: {
          status: input.status,
          completedAt: new Date(),
          errorCode: input.errorCode ?? null,
        },
      });
      if (claimed.count === 0) {
        const currentPreparation = await tx.corpusPreparation.findUnique({
          where: { id: input.preparationId },
        });
        if (currentPreparation?.status === input.status) {
          return currentPreparation;
        }
        throw problemException(
          LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: { reason: "PREPARATION_TERMINAL_CONFLICT" },
          },
        );
      }
      const current = await tx.legalCorpusVersion.findUnique({
        where: { id: input.corpusVersionId },
        select: { sourceManifest: true },
      });
      if (!current)
        throw problemException(
          LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      const manifest = isRecord(current.sourceManifest)
        ? current.sourceManifest
        : {};
      const validation = isRecord(manifest.validation)
        ? manifest.validation
        : {};
      const failureReadiness =
        input.status === CORPUS_PREPARATION_STATUSES.failed ||
        input.status === CORPUS_PREPARATION_STATUSES.blocked
          ? {
              [CORPUS_VERSION_READINESS_CHECKS.sourceParsing]:
                CORPUS_VERSION_READINESS_STATES.blocked,
            }
          : {};
      await tx.legalCorpusVersion.update({
        where: { id: input.corpusVersionId },
        data: {
          sourceManifest: {
            ...manifest,
            validation: {
              ...validation,
              ...failureReadiness,
              ...(input.readiness ?? {}),
              ...(input.integrityManifestRef
                ? { integrityManifestRef: input.integrityManifestRef }
                : {}),
            },
          },
          ...(input.integrityManifestRef
            ? { integrityManifestRef: input.integrityManifestRef }
            : {}),
        },
      });
      return { ...preparation, status: input.status };
    });
    return {
      id: updated.id,
      corpusVersionId: updated.targetCorpusId,
      status: updated.status,
    };
  }

  async detail(versionId: string): Promise<AdminCorpusVersionDetail> {
    const version = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: versionId },
      include: {
        documents: { include: { chunks: { select: { id: true } } } },
        retrievalIndexes: { orderBy: { validatedAt: "desc" } },
        preparation: { select: { requestedBy: true } },
      },
    });
    if (!version) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        "admin-corpus-version",
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }
    const manifest = isRecord(version.sourceManifest)
      ? version.sourceManifest
      : {};
    const changeSet = isRecord(manifest.changeSet) ? manifest.changeSet : null;
    // Publication readiness is authoritative only when reported by the
    // canonical validation/activation pipeline. Persistence shape alone must
    // never be promoted to READY in this read model.
    const readinessProjection = readReadinessProjection(manifest);
    const readiness = readinessProjection.aggregate;
    const trustedIntegrityRef = resolveTrustedIntegrityRef(version, manifest);
    const hasValidRetrievalIndex = hasValidatedRetrievalIndex(
      version.retrievalIndexes,
    );
    return {
      ...this.summary(
        {
          ...version,
          _count: { documents: version.documents.length },
        },
        await this.isCurrentActive(version.id),
      ),
      baseVersion: stringOrNull(changeSet?.baseCorpusVersion),
      createdBy: version.preparation?.requestedBy ?? null,
      sourcesAdded: arrayLength(changeSet?.addedDocumentIds),
      sourcesRemoved: arrayLength(changeSet?.removedDocumentIds),
      sourcesUpdated: arrayLength(changeSet?.changedDocumentIds),
      legalRulesChanged: null,
      engineeringRulesChanged: null,
      unresolvedConflicts: null,
      readiness,
      publicationState:
        version.status ===
        toPrismaLegalRuleLifecycleStatus(LEGAL_RULE_LIFECYCLE_STATUSES.approved)
          ? CORPUS_VERSION_PUBLICATION_STATES.published
          : readiness === CORPUS_VERSION_READINESS_STATES.failed ||
              readiness === CORPUS_VERSION_READINESS_STATES.blocked
            ? CORPUS_VERSION_PUBLICATION_STATES.blocked
            : readiness === CORPUS_VERSION_READINESS_STATES.ready
              ? CORPUS_VERSION_PUBLICATION_STATES.ready
              : CORPUS_VERSION_PUBLICATION_STATES.notReady,
      readinessItems: readinessProjection.items,
      snapshot: [
        {
          category: CORPUS_VERSION_SNAPSHOT_CATEGORIES.sourceDocuments,
          count: version.documents.length,
          change: snapshotChange(
            changeSet,
            "addedDocumentIds",
            "removedDocumentIds",
            "changedDocumentIds",
          ),
          validation: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
        {
          category: CORPUS_VERSION_SNAPSHOT_CATEGORIES.corpusChunks,
          count: version.documents.reduce(
            (total, document) => total + document.chunks.length,
            0,
          ),
          change: null,
          validation: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
        {
          category: CORPUS_VERSION_SNAPSHOT_CATEGORIES.legalRules,
          count: null,
          change: null,
          validation: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
        {
          category: CORPUS_VERSION_SNAPSHOT_CATEGORIES.engineeringRules,
          count: null,
          change: null,
          validation: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
      ],
      actions: {
        canPublish:
          version.status ===
            toPrismaLegalRuleLifecycleStatus(
              LEGAL_RULE_LIFECYCLE_STATUSES.draft,
            ) &&
          readiness === CORPUS_VERSION_READINESS_STATES.ready &&
          hasValidRetrievalIndex &&
          trustedIntegrityRef !== null,
        canDiscard:
          version.status ===
          toPrismaLegalRuleLifecycleStatus(LEGAL_RULE_LIFECYCLE_STATUSES.draft),
      },
    };
  }

  async discardDraft(input: {
    versionId: string;
    actorId: string;
    idempotencyKey: string;
    correlationId: string;
  }) {
    if (!input.idempotencyKey.trim()) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const existingReceipt =
      typeof this.prisma.corpusDiscardReceipt?.findUnique === "function"
        ? await this.prisma.corpusDiscardReceipt.findUnique({
            where: {
              actorId_idempotencyKey: {
                actorId: input.actorId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          })
        : null;
    if (existingReceipt) {
      if (existingReceipt.corpusVersionId !== input.versionId) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.corpusVersionAlreadyApproved,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return this.detail(input.versionId);
    }
    const version = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: input.versionId },
    });
    if (!version) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      version.status !==
      toPrismaLegalRuleLifecycleStatus(LEGAL_RULE_LIFECYCLE_STATUSES.draft)
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionAlreadyApproved,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await acquireLegalCorpusLifecycleLock(tx);
        if (typeof tx.corpusDiscardReceipt?.create === "function") {
          await tx.corpusDiscardReceipt.create({
            data: {
              corpusVersionId: input.versionId,
              actorId: input.actorId,
              idempotencyKey: input.idempotencyKey,
            },
          });
        }
        const discarded = await tx.legalCorpusVersion.updateMany({
          where: {
            id: input.versionId,
            status: toPrismaLegalRuleLifecycleStatus(
              LEGAL_RULE_LIFECYCLE_STATUSES.draft,
            ),
          },
          data: {
            status: toPrismaLegalRuleLifecycleStatus(
              LEGAL_RULE_LIFECYCLE_STATUSES.rejected,
            ),
          },
        });
        if (discarded.count !== 1) {
          throw problemException(
            LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
            input.correlationId,
            {
              status: HttpStatus.CONFLICT,
              meta: { reason: "CORPUS_NOT_DRAFT" },
            },
          );
        }
        await this.auditWriter.writeInTx(
          {
            eventType: LEGAL_RULE_EVENT_TYPES.corpusVersionDiscarded,
            actorId: input.actorId,
            actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
            resourceType: AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion,
            resourceId: input.versionId,
            decision: AUDIT_DECISIONS.allow,
            correlationId: input.correlationId,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            payload: { corpusVersionRef: `corpus-version:${input.versionId}` },
          },
          tx,
        );
      });
    } catch (error) {
      if (
        isUniqueConstraintError(error) &&
        typeof this.prisma.corpusDiscardReceipt?.findUnique === "function"
      ) {
        const replay = await this.prisma.corpusDiscardReceipt.findUnique({
          where: {
            actorId_idempotencyKey: {
              actorId: input.actorId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (replay?.corpusVersionId === input.versionId)
          return this.detail(input.versionId);
      }
      throw error;
    }
    return this.detail(input.versionId);
  }

  async publish(input: {
    versionId: string;
    actorId: string;
    idempotencyKey: string;
    correlationId: string;
  }) {
    if (!this.legalCorpus) {
      throw new Error("LegalCorpusService is required for publish");
    }
    const version = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: input.versionId },
      include: {
        retrievalIndexes: {
          orderBy: [{ validatedAt: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!version) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const replay =
      typeof this.prisma.corpusApprovalRecord?.findUnique === "function"
        ? await this.prisma.corpusApprovalRecord.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { legalCorpusVersionId: true },
          })
        : null;
    if (replay) {
      if (replay.legalCorpusVersionId !== input.versionId) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.corpusVersionAlreadyApproved,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return this.detail(input.versionId);
    }
    if (
      version.status !==
      toPrismaLegalRuleLifecycleStatus(LEGAL_RULE_LIFECYCLE_STATUSES.draft)
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionAlreadyApproved,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const manifest = isRecord(version.sourceManifest)
      ? version.sourceManifest
      : {};
    const readiness = readReadinessProjection(manifest).aggregate;
    const index = findValidatedRetrievalIndex(version.retrievalIndexes);
    const integrityManifestRef = resolveTrustedIntegrityRef(version, manifest);
    if (
      readiness !== CORPUS_VERSION_READINESS_STATES.ready ||
      !index ||
      !integrityManifestRef
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        { status: HttpStatus.CONFLICT, meta: { reason: "CORPUS_NOT_READY" } },
      );
    }
    const previous = await this.prisma.legalCorpusVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
      },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    try {
      await this.legalCorpus.activateValidatedCorpusVersion({
        corpusVersionId: input.versionId,
        integrityManifestRef,
        retrievalValidationRef: index.validationManifestRef!,
        idempotencyKey: input.idempotencyKey,
        scopeDescription: "Activated by Admin",
        comments: null,
        correlationId: input.correlationId,
        initiatingAdminActorId: input.actorId,
      });
      return this.detail(input.versionId);
    } catch (error) {
      try {
        await this.auditWriter.write({
          eventType: LEGAL_RULE_EVENT_TYPES.corpusVersionActivated,
          actorId: input.actorId,
          actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
          resourceType: AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion,
          resourceId: input.versionId,
          decision: AUDIT_DECISIONS.deny,
          correlationId: input.correlationId,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            targetVersionId: input.versionId,
            previousActiveVersionId: previous?.id ?? null,
            result: CORPUS_PREPARATION_STATUSES.failed,
          },
        });
      } catch {
        // Preserve the canonical activation error when secondary audit fails.
      }
      throw error;
    }
  }

  private async isCurrentActive(versionId: string): Promise<boolean> {
    if (typeof this.prisma.legalCorpusVersion.findFirst !== "function") {
      return false;
    }
    const active = await this.prisma.legalCorpusVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
      },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    return active?.id === versionId;
  }

  private summary(
    version: {
      id: string;
      version: string;
      status: string;
      createdAt: Date;
      approvedAt: Date | null;
      _count: { documents: number };
    },
    isCurrentActive = false,
  ): AdminCorpusVersionSummary {
    const status = fromPrismaLegalRuleLifecycleStatus(version.status as never);
    return {
      id: version.id,
      version: version.version,
      status,
      presentationStatus:
        status === LEGAL_RULE_LIFECYCLE_STATUSES.draft
          ? CORPUS_VERSION_PRESENTATION_STATUSES.draft
          : status === LEGAL_RULE_LIFECYCLE_STATUSES.approved && isCurrentActive
            ? CORPUS_VERSION_PRESENTATION_STATUSES.published
            : status === LEGAL_RULE_LIFECYCLE_STATUSES.superseded
              ? CORPUS_VERSION_PRESENTATION_STATUSES.archived
              : CORPUS_VERSION_PRESENTATION_STATUSES.unavailable,
      isCurrentActive,
      sourceCount: version._count.documents,
      legalRuleCount: null,
      engineeringRuleCount: null,
      createdAt: version.createdAt.toISOString(),
      publishedAt: version.approvedAt?.toISOString() ?? null,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
function snapshotChange(
  changeSet: Record<string, unknown> | null,
  ...keys: string[]
): { added: number; removed: number; updated: number } | null {
  if (!changeSet) return null;
  const [added, removed, updated] = keys.map(
    (key) => arrayLength(changeSet[key]) ?? 0,
  );
  return { added, removed, updated };
}

function readReadinessProjection(manifest: Record<string, unknown>) {
  const raw = isRecord(manifest.validation) ? manifest.validation : null;
  const applicable = isRecord(raw?.applicable) ? raw.applicable : null;
  const state = (value: unknown): CorpusVersionReadinessState => {
    if (value === CORPUS_VERSION_READINESS_STATES.pending)
      return CORPUS_VERSION_READINESS_STATES.pending;
    if (value === CORPUS_VERSION_READINESS_STATES.passed)
      return CORPUS_VERSION_READINESS_STATES.passed;
    if (value === CORPUS_VERSION_READINESS_STATES.failed)
      return CORPUS_VERSION_READINESS_STATES.failed;
    if (value === CORPUS_VERSION_READINESS_STATES.blocked)
      return CORPUS_VERSION_READINESS_STATES.blocked;
    if (value === CORPUS_VERSION_READINESS_STATES.unavailable)
      return CORPUS_VERSION_READINESS_STATES.unavailable;
    return CORPUS_VERSION_READINESS_STATES.unavailable;
  };
  const items = Object.values(CORPUS_VERSION_READINESS_CHECKS).map((check) => ({
    check,
    state: state(raw?.[check] ?? raw?.[check.toLowerCase()]),
  }));
  const states = items
    .filter((item) => applicable?.[item.check] !== false)
    .map((item) => item.state);
  const aggregate = states.includes(CORPUS_VERSION_READINESS_STATES.failed)
    ? CORPUS_VERSION_READINESS_STATES.failed
    : states.includes(CORPUS_VERSION_READINESS_STATES.blocked)
      ? CORPUS_VERSION_READINESS_STATES.blocked
      : states.every(
            (item) =>
              item === CORPUS_VERSION_READINESS_STATES.ready ||
              item === CORPUS_VERSION_READINESS_STATES.passed,
          )
        ? CORPUS_VERSION_READINESS_STATES.ready
        : states.some(
              (item) => item === CORPUS_VERSION_READINESS_STATES.pending,
            )
          ? CORPUS_VERSION_READINESS_STATES.pending
          : CORPUS_VERSION_READINESS_STATES.unavailable;
  return { items, aggregate };
}

function findValidatedRetrievalIndex<
  T extends {
    status: string;
    validatedAt: Date | null;
    validationManifestRef: string | null;
  },
>(indexes: T[]): T | null {
  return (
    indexes.find(
      (index) =>
        index.status === "VALID" &&
        index.validatedAt !== null &&
        index.validationManifestRef !== null,
    ) ?? null
  );
}

function hasValidatedRetrievalIndex(
  indexes: Array<{
    status: string;
    validatedAt: Date | null;
    validationManifestRef: string | null;
  }>,
): boolean {
  return findValidatedRetrievalIndex(indexes) !== null;
}

function resolveTrustedIntegrityRef(
  version: { integrityManifestRef: string | null },
  manifest: Record<string, unknown>,
): string | null {
  if (version.integrityManifestRef) return version.integrityManifestRef;
  const validation = isRecord(manifest.validation) ? manifest.validation : {};
  return stringOrNull(validation.integrityManifestRef);
}

function inferGovernedSourceRequest(document: {
  documentId: string;
  sourceUrl: string;
  sourceEffectStatus: string;
}) {
  try {
    const parsed = new URL(document.sourceUrl);
    const host = parsed.hostname.toLowerCase();
    if (host !== "vbpl.vn" && host !== "vanban.chinhphu.vn") return null;
    const gatewayDocumentId =
      host === "vbpl.vn"
        ? (parsed.pathname.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/iu)?.[0] ?? null)
        : null;
    if (host === "vbpl.vn" && !gatewayDocumentId) return null;
    return {
      documentId: document.documentId,
      catalogSourceRef: `catalog-source:${host}:document:${document.documentId.toLowerCase()}`,
      sourceUrl: document.sourceUrl,
      ...(gatewayDocumentId ? { gatewayDocumentId } : {}),
      sourceEffectStatus: document.sourceEffectStatus,
    };
  } catch {
    return null;
  }
}
