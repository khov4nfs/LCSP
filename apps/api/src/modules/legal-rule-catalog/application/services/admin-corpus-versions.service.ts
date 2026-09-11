import { HttpStatus, Injectable } from "@nestjs/common";
import {
  CORPUS_VERSION_READINESS_CHECKS,
  CORPUS_VERSION_READINESS_STATES,
  CORPUS_VERSION_SNAPSHOT_CATEGORIES,
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_EVENT_TYPES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
  type AdminCorpusVersionDetail,
  type AdminCorpusVersionSummary,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";

import {
  fromPrismaLegalRuleLifecycleStatus,
  toPrismaLegalRuleLifecycleStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";

@Injectable()
export class AdminCorpusVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async list() {
    const versions = await this.prisma.legalCorpusVersion.findMany({
      include: { _count: { select: { documents: true } } },
      orderBy: { createdAt: "desc" },
    });
    const summaries = versions.map((version) => this.summary(version));
    return {
      currentPublished:
        summaries.find(
          (version) =>
            version.status === LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ) ?? null,
      versions: summaries,
      canCreate: false as const,
    };
  }

  async detail(versionId: string): Promise<AdminCorpusVersionDetail> {
    const version = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: versionId },
      include: {
        documents: { include: { chunks: { select: { id: true } } } },
        retrievalIndexes: { orderBy: { validatedAt: "desc" } },
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
    const readiness = CORPUS_VERSION_READINESS_STATES.unavailable;
    return {
      ...this.summary({
        ...version,
        _count: { documents: version.documents.length },
      }),
      baseVersion: stringOrNull(changeSet?.baseCorpusVersion),
      createdBy: null,
      sourcesAdded: arrayLength(changeSet?.addedDocumentIds),
      sourcesRemoved: arrayLength(changeSet?.removedDocumentIds),
      sourcesUpdated: arrayLength(changeSet?.changedDocumentIds),
      legalRulesChanged: null,
      engineeringRulesChanged: null,
      unresolvedConflicts: null,
      readiness,
      readinessItems: [
        {
          check: CORPUS_VERSION_READINESS_CHECKS.sourceParsing,
          state: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
        {
          check: CORPUS_VERSION_READINESS_CHECKS.retrievalValidation,
          state: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
        {
          check: CORPUS_VERSION_READINESS_CHECKS.integrityManifest,
          state: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
        {
          check: CORPUS_VERSION_READINESS_CHECKS.ruleSnapshot,
          state: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
        {
          check: CORPUS_VERSION_READINESS_CHECKS.diffReview,
          state: CORPUS_VERSION_READINESS_STATES.unavailable,
        },
      ],
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
        canPublish: false,
        canDiscard:
          version.status ===
          toPrismaLegalRuleLifecycleStatus(LEGAL_RULE_LIFECYCLE_STATUSES.draft),
      },
    };
  }

  async discardDraft(input: {
    versionId: string;
    actorId: string;
    correlationId: string;
  }) {
    const version = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: input.versionId },
    });
    if (
      !version ||
      version.status !==
        toPrismaLegalRuleLifecycleStatus(LEGAL_RULE_LIFECYCLE_STATUSES.draft)
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionAlreadyApproved,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.legalCorpusVersion.update({
        where: { id: input.versionId },
        data: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.rejected,
          ),
        },
      });
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
    return this.detail(input.versionId);
  }

  private summary(version: {
    id: string;
    version: string;
    status: string;
    createdAt: Date;
    approvedAt: Date | null;
    _count: { documents: number };
  }): AdminCorpusVersionSummary {
    return {
      id: version.id,
      version: version.version,
      status: fromPrismaLegalRuleLifecycleStatus(version.status as never),
      sourceCount: version._count.documents,
      ruleCount: null,
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
