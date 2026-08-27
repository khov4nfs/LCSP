import { createHash, randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES,
  ACTIVATE_VALIDATED_CORPUS_VERSION_TOOL,
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
  LEGAL_MATCHING_REQUEST_COMMAND,
  LEGAL_CORPUS_TRUST_POLICIES,
  LEGAL_RULE_EVENT_TYPES,
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
  RESUME_WAITING_RUNS_TOOL,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { LegalRetrievalIndexStatus, Prisma } from "@prisma/client";
import { VERIFIED_PROFILE_STATUSES } from "@lcsp/contracts/scan";

import {
  toPrismaLegalRuleLifecycleStatus,
  toPrismaVerifiedProfileStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import type {
  IngestLegalCorpusRequest,
  LegalCorpusDocumentInput,
} from "../contracts/legal-corpus.contract.js";

const INDEPENDENT_AUDIT_PRINCIPAL_POLICY =
  "TECHNICAL_AUDIT_PRINCIPALS_INDEPENDENT";
const SAFE_MANIFEST_REF = /^[a-z][a-z0-9-]{0,63}:[A-Za-z0-9._:-]{1,180}$/;
const LEGAL_CORPUS_ACTIVATION_SERVICE = "legal-corpus-activation-service";
const LEGAL_CHUNK_NORMATIVE_CLASSES = {
  engineeringRuleCandidate: "ENGINEERING_RULE_CANDIDATE",
  contextOnly: "CONTEXT_ONLY",
  excludeFromDatabase: "EXCLUDE_FROM_DATABASE",
} as const;
const LEGAL_CONTEXT_ONLY_ARTICLE_TITLE_TERMS = [
  "phạm vi điều chỉnh",
  "đối tượng áp dụng",
  "giải thích từ ngữ",
  "nguyên tắc cơ bản",
  "chính sách của nhà nước",
] as const;
const LEGAL_ENGINEERING_OBLIGATION_TERMS = [
  "phải",
  "không được",
  "bị nghiêm cấm",
  "nghiêm cấm",
  "có trách nhiệm",
  "nghĩa vụ",
  "bảo đảm",
  "duy trì",
  "thiết lập",
  "kiểm tra",
  "giám sát",
  "đánh giá",
  "quản lý rủi ro",
  "thông báo",
  "công bố",
  "báo cáo",
  "lưu trữ",
  "ghi nhận",
  "kiểm soát",
  "can thiệp",
  "tuân thủ",
] as const;
const OUTBOX_VISIBLE_STATUSES = [
  OUTBOX_STATUSES.pending,
  OUTBOX_STATUSES.published,
  OUTBOX_STATUSES.failed,
] as const;
const LEGAL_CORPUS_CHANGE_MODES = {
  fullBuild: "FULL_BUILD",
  partialUpdate: "PARTIAL_UPDATE",
  noChanges: "NO_CHANGES",
} as const;

interface LegalReviewDocumentSignoff {
  documentId: string;
  reviewState: "APPROVED";
  reviewedBy: string;
  reviewedAt: string;
  reviewedSourceSha256: string;
  reviewedTextSha256: string;
  hierarchyReviewSha256: string;
}

interface LegalReviewSignoff {
  state: "APPROVED";
  reviewedBy: string;
  identityPolicy: string | null;
  approvalActorMayDiffer: boolean;
  documents: LegalReviewDocumentSignoff[];
}

interface ReviewTargetDocument {
  documentId: string;
  sourceSha256: string;
}

@Injectable()
export class LegalCorpusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async ingestDraft(input: IngestLegalCorpusRequest) {
    const selectedInput = this.selectDatabaseLegalChunks(input);
    this.validateIngest(selectedInput);
    const changeSet = await this.detectCorpusChanges(selectedInput);
    if (changeSet.mode === LEGAL_CORPUS_CHANGE_MODES.noChanges) {
      return {
        id: changeSet.baseCorpusVersionId,
        version: changeSet.baseCorpusVersion,
        status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        documentCount: selectedInput.documents.length,
        chunkCount: selectedInput.documents.reduce(
          (count, document) => count + document.chunks.length,
          0,
        ),
        noChanges: true,
        changeSet,
      };
    }

    const existing = await this.prisma.legalCorpusVersion.findUnique({
      where: { version: selectedInput.version },
      select: { id: true },
    });
    if (existing) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        "legal-corpus-ingest",
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
      const corpus = await tx.legalCorpusVersion.create({
        data: {
          version: selectedInput.version,
          sourceManifest: enrichedManifest,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.draft,
          ),
        },
      });

      for (const document of selectedInput.documents) {
        await this.createDocument(tx, corpus.id, document);
      }

      return {
        id: corpus.id,
        version: corpus.version,
        status: LEGAL_RULE_LIFECYCLE_STATUSES.draft,
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

  async activateValidatedCorpusVersion(input: {
    corpusVersionId: string;
    integrityManifestRef: string;
    retrievalValidationRef: string;
    idempotencyKey: string;
    scopeDescription: string;
    comments: string | null;
    correlationId: string;
  }) {
    this.validateActivationInput(input);

    const replay = await this.prisma.corpusApprovalRecord.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { corpusVersion: true },
    });
    if (replay) {
      if (replay.legalCorpusVersionId !== input.corpusVersionId) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.corpusVersionAlreadyApproved,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: {
              reason:
                ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES.activationReplayConflict,
            },
          },
        );
      }
      return this.toActivationResponse(
        replay.corpusVersion.id,
        replay.corpusVersion.version,
        input.correlationId,
        replay.id,
        replay.outboxEventId ?? "",
      );
    }

    const corpus = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: input.corpusVersionId },
      include: {
        documents: { include: { chunks: true } },
        retrievalIndexes: {
          orderBy: [{ validatedAt: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!corpus) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      corpus.status !==
      toPrismaLegalRuleLifecycleStatus(LEGAL_RULE_LIFECYCLE_STATUSES.draft)
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionAlreadyApproved,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: {
            reason:
              ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES.corpusVersionNotDraft,
          },
        },
      );
    }
    if (
      corpus.documents.length === 0 ||
      corpus.documents.some((document) => document.chunks.length === 0)
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const retrievalIndex = corpus.retrievalIndexes.find(
      (index) => index.validationManifestRef === input.retrievalValidationRef,
    );
    if (!retrievalIndex) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES.retrievalValidationMissing,
          },
        },
      );
    }
    if (retrievalIndex.status !== "VALID" || !retrievalIndex.validatedAt) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES.retrievalIndexNotValid,
          },
        },
      );
    }

    const approvedAt = new Date();
    let approvalRecordId = "";
    let outboxEventId = "";
    await this.prisma.$transaction(async (tx) => {
      const superseded = await tx.legalCorpusVersion.updateMany({
        where: {
          id: { not: corpus.id },
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        },
        data: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.superseded,
          ),
        },
      });

      await tx.legalCorpusVersion.update({
        where: { id: corpus.id },
        data: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          approvedAt,
          integrityManifestRef: input.integrityManifestRef,
        },
      });
      const approval = await tx.corpusApprovalRecord.create({
        data: {
          legalCorpusVersionId: corpus.id,
          approvedBy: LEGAL_CORPUS_ACTIVATION_SERVICE,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          idempotencyKey: input.idempotencyKey,
          integrityManifestRef: input.integrityManifestRef,
          retrievalValidationRef: input.retrievalValidationRef,
          scopeDescription: input.scopeDescription,
          comments: input.comments,
          approvalDate: approvedAt,
        },
      });
      approvalRecordId = approval.id;

      const outboxEvent = buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.legalCorpusVersion,
        aggregateId: corpus.id,
        eventType: LEGAL_RULE_EVENT_TYPES.corpusVersionActivated,
        correlationId: input.correlationId,
        causationId: approval.id,
        actor: {
          id: LEGAL_CORPUS_ACTIVATION_SERVICE,
          type: AUDIT_ACTOR_TYPES.system,
        },
        result: AGENTIC_TOOL_STATUSES.ready,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${corpus.id}:${input.idempotencyKey}:activation`,
        payload: {
          corpusVersionRef: `corpus-version:${corpus.id}`,
          activationRecordRef: `corpus-approval:${approval.id}`,
          integrityManifestRef: input.integrityManifestRef,
          retrievalValidationRef: input.retrievalValidationRef,
          supersededApprovedCount: superseded.count,
        },
      });
      outboxEventId = await this.outboxRepository.enqueue(outboxEvent, tx);
      await tx.corpusApprovalRecord.update({
        where: { id: approval.id },
        data: { outboxEventId },
      });

      await this.auditWriter.writeInTx(
        {
          eventType: LEGAL_RULE_EVENT_TYPES.corpusVersionActivated,
          actorId: LEGAL_CORPUS_ACTIVATION_SERVICE,
          actor: {
            id: LEGAL_CORPUS_ACTIVATION_SERVICE,
            type: AUDIT_ACTOR_TYPES.system,
          },
          resourceType: AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion,
          resourceId: corpus.id,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            toolName: ACTIVATE_VALIDATED_CORPUS_VERSION_TOOL.name,
            corpusVersionRef: `corpus-version:${corpus.id}`,
            activationRecordRef: `corpus-approval:${approval.id}`,
            outboxEventRef: `outbox:${outboxEventId}`,
            integrityManifestRef: input.integrityManifestRef,
            retrievalValidationRef: input.retrievalValidationRef,
            manualApprovalRequired: false,
            idempotencyKey: input.idempotencyKey,
          },
        },
        tx,
      );

      await this.enqueueWaitingLegalMatchingRunsAfterActivation(tx, {
        corpusVersionId: corpus.id,
        correlationId: input.correlationId,
        activationIdempotencyKey: input.idempotencyKey,
      });
    });

    return this.toActivationResponse(
      corpus.id,
      corpus.version,
      input.correlationId,
      approvalRecordId,
      outboxEventId,
    );
  }

  async registerValidatedRetrievalIndex(input: {
    corpusVersionId: string;
    version: string;
    configHash: string;
    contentHash: string;
    validationManifestRef: string;
    validatedAt?: string | null;
    correlationId: string;
  }) {
    this.validateRetrievalIndexInput(input);

    const corpus = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: input.corpusVersionId },
      select: { id: true, version: true },
    });
    if (!corpus) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const existing = await this.prisma.legalRetrievalIndex.findUnique({
      where: { version: input.version },
      select: {
        id: true,
        legalCorpusVersionId: true,
        version: true,
        status: true,
        validationManifestRef: true,
      },
    });
    if (existing) {
      if (
        existing.legalCorpusVersionId !== input.corpusVersionId ||
        existing.validationManifestRef !== input.validationManifestRef
      ) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
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
        legalCorpusVersionId: input.corpusVersionId,
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
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES.integrityManifestInvalid,
          },
        },
      );
    }
    if (!SAFE_MANIFEST_REF.test(input.retrievalValidationRef)) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason:
              ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES.retrievalValidationMismatch,
          },
        },
      );
    }
    if (!input.idempotencyKey.trim()) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
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
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { reason: "retrieval_index_validation_manifest_invalid" },
        },
      );
    }
  }

  private toActivationResponse(
    corpusId: string,
    version: string,
    correlationId: string,
    approvalRecordId: string,
    outboxEventId: string,
  ) {
    return {
      id: corpusId,
      version,
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      correlationId,
      toolName: ACTIVATE_VALIDATED_CORPUS_VERSION_TOOL.name,
      toolVersion: ACTIVATE_VALIDATED_CORPUS_VERSION_TOOL.version,
      configHash: ACTIVATE_VALIDATED_CORPUS_VERSION_TOOL.configHash,
      artifactVersions: { corpusVersionId: corpusId },
      provenanceRef: `tool-execution:${correlationId}`,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: [
        `corpus-approval:${approvalRecordId}`,
        `outbox:${outboxEventId}`,
      ],
      limitations: [],
      result: {
        activeCorpusVersionRef: `corpus-version:${corpusId}`,
        lifecycleStatus: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        activationRecordRef: `corpus-approval:${approvalRecordId}`,
        outboxEventRef: `outbox:${outboxEventId}`,
        systemActor: LEGAL_CORPUS_ACTIVATION_SERVICE,
        manualApprovalRequired: false,
      },
    };
  }

  private async enqueueWaitingLegalMatchingRunsAfterActivation(
    tx: Prisma.TransactionClient,
    input: {
      corpusVersionId: string;
      correlationId: string;
      activationIdempotencyKey: string;
    },
  ): Promise<void> {
    const catalog = await tx.legalRuleCatalogVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
        approvedAt: { not: null },
      },
      orderBy: { approvedAt: "desc" },
      select: { id: true },
    });
    if (!catalog) {
      return;
    }

    const approvedProfiles = await tx.verifiedProfile.findMany({
      where: {
        status: toPrismaVerifiedProfileStatus(
          VERIFIED_PROFILE_STATUSES.approved,
        ),
      },
      orderBy: [{ approvedAt: "asc" }, { createdAt: "asc" }],
      take: RESUME_WAITING_RUNS_TOOL.maxRuns,
      select: {
        id: true,
        assessmentId: true,
      },
    });
    if (approvedProfiles.length === 0) {
      return;
    }

    const profileIds = approvedProfiles.map((profile) => profile.id);
    const [existingMatches, existingCommands] = await Promise.all([
      tx.legalRuleMatch.findMany({
        where: {
          verifiedProfileId: { in: profileIds },
          corpusVersionId: input.corpusVersionId,
        },
        select: { verifiedProfileId: true },
      }),
      tx.outboxMessage.findMany({
        where: {
          aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
          aggregateId: { in: profileIds },
          eventType: LEGAL_MATCHING_REQUEST_COMMAND,
          status: { in: [...OUTBOX_VISIBLE_STATUSES] },
        },
        select: { aggregateId: true },
      }),
    ]);

    const matchedProfileIds = new Set(
      existingMatches.map((match) => match.verifiedProfileId),
    );
    const commandedProfileIds = new Set(
      existingCommands.map((message) => message.aggregateId),
    );

    for (const profile of approvedProfiles) {
      if (
        matchedProfileIds.has(profile.id) ||
        commandedProfileIds.has(profile.id)
      ) {
        continue;
      }

      const event = buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
        aggregateId: profile.id,
        eventType: LEGAL_MATCHING_REQUEST_COMMAND,
        assessmentId: profile.assessmentId,
        correlationId: input.correlationId,
        causationId: input.corpusVersionId,
        actor: {
          id: LEGAL_CORPUS_ACTIVATION_SERVICE,
          type: AUDIT_ACTOR_TYPES.system,
        },
        result: LEGAL_MATCHING_REQUEST_COMMAND,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${profile.id}:${LEGAL_MATCHING_REQUEST_COMMAND}:${input.corpusVersionId}`,
        payload: {
          verifiedProfileId: profile.id,
          assessmentId: profile.assessmentId,
          corpusVersionId: input.corpusVersionId,
          legalRuleCatalogVersionId: catalog.id,
          checkpointRef: `corpus-activation:${input.activationIdempotencyKey}:${profile.id}`,
          correlationId: input.correlationId,
        },
      });
      await this.outboxRepository.enqueue(event, tx);
    }
  }

  async getApprovedChunks(corpusVersionId: string) {
    const corpus = await this.prisma.legalCorpusVersion.findFirst({
      where: {
        id: corpusVersionId,
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
      },
      include: { chunks: { orderBy: { id: "asc" } } },
    });
    if (!corpus) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.approvedCorpusNotFound,
        "legal-corpus-chunks",
        { status: HttpStatus.NOT_FOUND },
      );
    }
    return {
      versionId: corpus.id,
      version: corpus.version,
      chunks: corpus.chunks.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        locator: chunk.locator,
        content: chunk.content,
        contentSha256: chunk.contentSha256,
        hierarchy: chunk.hierarchy,
        legalStatus: chunk.legalStatus,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
      })),
    };
  }

  private async detectCorpusChanges(input: IngestLegalCorpusRequest) {
    const base = await this.prisma.legalCorpusVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
        approvedAt: { not: null },
      },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
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
        mode: LEGAL_CORPUS_CHANGE_MODES.fullBuild,
        baseCorpusVersionId: null,
        baseCorpusVersion: null,
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
          ? LEGAL_CORPUS_CHANGE_MODES.noChanges
          : LEGAL_CORPUS_CHANGE_MODES.partialUpdate,
      baseCorpusVersionId: base.id,
      baseCorpusVersion: base.version,
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
    legalCorpusVersionId: string,
    document: LegalCorpusDocumentInput,
  ): Promise<void> {
    const sourceDocument = await tx.legalSourceDocument.create({
      data: {
        legalCorpusVersionId,
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
        legalCorpusVersionId,
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

  private selectDatabaseLegalChunks(
    input: IngestLegalCorpusRequest,
  ): IngestLegalCorpusRequest {
    return {
      ...input,
      sourceManifest: {
        ...input.sourceManifest,
        chunkSelectionPolicy:
          "Persist only hierarchy-addressable legal chunks; exclude formal headers/preamble. Context-only chunks are retained but not EngineeringRule source candidates.",
      },
      documents: input.documents.map((document) => ({
        ...document,
        chunks: (Array.isArray(document.chunks) ? document.chunks : [])
          .map((chunk) => {
            const normativeClass = this.legalChunkNormativeClass(chunk);
            return {
              ...chunk,
              hierarchy: {
                ...chunk.hierarchy,
                normativeClass,
              },
            };
          })
          .filter(
            (chunk) =>
              chunk.hierarchy.normativeClass !==
              LEGAL_CHUNK_NORMATIVE_CLASSES.excludeFromDatabase,
          ),
      })),
    };
  }

  private legalChunkNormativeClass(
    chunk: LegalCorpusDocumentInput["chunks"][number],
  ) {
    const rawContent = chunk.content;
    const content = normalizeLegalText(rawContent);
    if (!content) return LEGAL_CHUNK_NORMATIVE_CLASSES.excludeFromDatabase;
    if (isLegalHeadingOnly(rawContent) || isLegalPreambleOnly(rawContent)) {
      return LEGAL_CHUNK_NORMATIVE_CLASSES.excludeFromDatabase;
    }
    const articleTitle = normalizeLegalText(
      typeof chunk.hierarchy.articleTitle === "string"
        ? chunk.hierarchy.articleTitle
        : "",
    );
    if (
      LEGAL_CONTEXT_ONLY_ARTICLE_TITLE_TERMS.some((term) =>
        articleTitle.includes(term),
      )
    ) {
      return LEGAL_CHUNK_NORMATIVE_CLASSES.contextOnly;
    }
    if (
      LEGAL_ENGINEERING_OBLIGATION_TERMS.some((term) => content.includes(term))
    ) {
      return LEGAL_CHUNK_NORMATIVE_CLASSES.engineeringRuleCandidate;
    }
    return LEGAL_CHUNK_NORMATIVE_CLASSES.contextOnly;
  }

  private validateIngest(input: IngestLegalCorpusRequest): void {
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
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        "legal-corpus-ingest",
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    this.requireApprovedReviewSignoff(
      input.sourceManifest,
      input.documents.map((document) => ({
        documentId: document.documentId,
        sourceSha256: document.sourceSha256,
      })),
      "legal-corpus-ingest",
    );
  }

  private requireApprovedReviewSignoff(
    sourceManifest: unknown,
    targetDocuments: ReviewTargetDocument[],
    correlationId: string,
  ): LegalReviewSignoff {
    const invalid = (reason: string): never => {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { reason },
        },
      );
    };

    if (!isRecord(sourceManifest)) {
      return invalid("legal_operator_signoff_required");
    }
    if (
      sourceManifest.reviewRequired === false &&
      sourceManifest.trustPolicy ===
        LEGAL_CORPUS_TRUST_POLICIES.officialSourceAutoTrusted
    ) {
      return {
        state: "APPROVED",
        reviewedBy: LEGAL_CORPUS_TRUST_POLICIES.officialSourceAutoTrusted,
        identityPolicy: null,
        approvalActorMayDiffer: false,
        documents: [],
      };
    }
    if (sourceManifest.reviewRequired !== true) {
      return invalid("legal_operator_signoff_required");
    }
    const warnings = sourceManifest.normalizationWarnings;
    if (Array.isArray(warnings) && warnings.length > 0) {
      return invalid("normalization_warnings_unresolved");
    }

    const rawSignoff = sourceManifest.reviewSignoff;
    if (!isRecord(rawSignoff) || rawSignoff.state !== "APPROVED") {
      return invalid("legal_operator_signoff_not_approved");
    }
    const reviewedBy = stringValue(rawSignoff.reviewedBy);
    const rawDocuments = rawSignoff.documents;
    if (!reviewedBy || !Array.isArray(rawDocuments)) {
      return invalid("legal_operator_signoff_invalid");
    }

    const identityPolicy = stringValue(rawSignoff.identityPolicy) || null;
    const approvalActorMayDiffer =
      rawSignoff.approvalActorMayDiffer === true &&
      identityPolicy === INDEPENDENT_AUDIT_PRINCIPAL_POLICY;
    if (rawSignoff.approvalActorMayDiffer === true && !approvalActorMayDiffer) {
      return invalid("legal_operator_identity_policy_invalid");
    }

    const documents: LegalReviewDocumentSignoff[] = [];
    for (const rawDocument of rawDocuments) {
      if (!isRecord(rawDocument)) {
        return invalid("legal_operator_document_signoff_invalid");
      }
      const documentId = stringValue(rawDocument.documentId);
      const documentReviewedBy = stringValue(rawDocument.reviewedBy);
      const reviewedAt = stringValue(rawDocument.reviewedAt);
      const reviewedSourceSha256 = stringValue(
        rawDocument.reviewedSourceSha256,
      );
      const reviewedTextSha256 = stringValue(rawDocument.reviewedTextSha256);
      const hierarchyReviewSha256 = stringValue(
        rawDocument.hierarchyReviewSha256,
      );
      if (
        !documentId ||
        rawDocument.reviewState !== "APPROVED" ||
        documentReviewedBy !== reviewedBy ||
        !reviewedAt ||
        !isSha256(reviewedSourceSha256) ||
        !isSha256(reviewedTextSha256) ||
        !isSha256(hierarchyReviewSha256)
      ) {
        return invalid("legal_operator_document_signoff_invalid");
      }
      documents.push({
        documentId,
        reviewState: "APPROVED",
        reviewedBy: documentReviewedBy,
        reviewedAt,
        reviewedSourceSha256,
        reviewedTextSha256,
        hierarchyReviewSha256,
      });
    }

    const signoffByDocumentId = new Map(
      documents.map((document) => [document.documentId, document]),
    );
    if (
      documents.length !== targetDocuments.length ||
      signoffByDocumentId.size !== targetDocuments.length
    ) {
      return invalid("legal_operator_signoff_document_set_mismatch");
    }
    for (const targetDocument of targetDocuments) {
      const signoff = signoffByDocumentId.get(targetDocument.documentId);
      if (!signoff) {
        return invalid("legal_operator_signoff_document_set_mismatch");
      }
      if (signoff.reviewedSourceSha256 !== targetDocument.sourceSha256) {
        return invalid("legal_operator_signoff_source_hash_mismatch");
      }
    }

    return {
      state: "APPROVED",
      reviewedBy,
      identityPolicy,
      approvalActorMayDiffer,
      documents,
    };
  }
}

function hash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/i.test(value);
}

function normalizeLegalText(value: string): string {
  return value.toLocaleLowerCase("vi-VN").split(/\s+/u).join(" ").trim();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
