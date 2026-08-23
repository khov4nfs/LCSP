import { createHash } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  LegalRuleLifecycleStatus as PrismaLegalRuleLifecycleStatus,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";

const LEGAL_ENGINEERING_RULE_FAMILY = "LEGAL_CORPUS_ENGINEERING_RULE_SOURCE";
const LEGAL_RULE_RECOVERY_SERVICE = "legal-rule-source-recovery-service";
const LEGAL_UNKNOWN_FACT_POLICY = "BLOCK_ON_UNKNOWN";
const LEGAL_REPEALED_CHUNK_STATUS = "REPEALED";
const LEGAL_ENGINEERING_CANDIDATE_CLASS = "ENGINEERING_RULE_CANDIDATE";
const LEGAL_CONTEXT_ONLY_CLASS = "CONTEXT_ONLY";
const LEGAL_EXCLUDE_FROM_DATABASE_CLASS = "EXCLUDE_FROM_DATABASE";
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

export interface RecoverApprovedRulesFromActiveCorpusInput {
  idempotencyKey: string;
  correlationId: string;
}

@Injectable()
export class RuleCatalogVersionService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(version: string, correlationId: string) {
    if (!version?.trim()) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const existing = await this.prisma.legalRuleCatalogVersion.findFirst({
      where: { version },
      select: { id: true },
    });
    if (existing) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.catalogVersionAlreadyApproved,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const catalog = await this.prisma.legalRuleCatalogVersion.create({
      data: { version, ruleRefs: [] },
    });
    return {
      id: catalog.id,
      version: catalog.version,
      status: LEGAL_RULE_LIFECYCLE_STATUSES.draft,
    };
  }

  async recoverApprovedRulesFromActiveCorpus(
    input: RecoverApprovedRulesFromActiveCorpusInput,
  ) {
    if (!input.idempotencyKey.trim()) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const approvedStatus = toPrismaLegalRuleLifecycleStatus(
      LEGAL_RULE_LIFECYCLE_STATUSES.approved,
    );
    const existing =
      await this.findLatestApprovedCatalogWithRules(approvedStatus);
    if (existing) {
      return {
        id: existing.id,
        version: existing.version,
        status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        corpusVersionId: null,
        ruleCount: existing.ruleCount,
        noChanges: true,
      };
    }

    const corpus = await this.prisma.legalCorpusVersion.findFirst({
      where: {
        status: approvedStatus,
        approvedAt: { not: null },
      },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      include: { chunks: { orderBy: { id: "asc" } } },
    });
    if (!corpus) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.approvedCorpusNotFound,
        input.correlationId,
        { status: HttpStatus.SERVICE_UNAVAILABLE },
      );
    }

    const candidateChunks = corpus.chunks.filter(
      (chunk) =>
        chunk.legalStatus !== LEGAL_REPEALED_CHUNK_STATUS &&
        normativeClass(chunk) === LEGAL_ENGINEERING_CANDIDATE_CLASS,
    );
    if (candidateChunks.length === 0) {
      return {
        id: "",
        version: "",
        status: LEGAL_RULE_LIFECYCLE_STATUSES.draft,
        corpusVersionId: corpus.id,
        ruleCount: 0,
        noChanges: false,
      };
    }

    const version = `AUTO-ENGINEERING-RULES-${sourceDigest(
      corpus.id,
      candidateChunks.map((chunk) => `${chunk.id}:${chunk.contentSha256}`),
    )}`;
    const existingVersion = await this.prisma.legalRuleCatalogVersion.findFirst(
      {
        where: { version },
        select: { id: true, version: true, status: true },
      },
    );
    if (existingVersion) {
      const ruleCount = await this.prisma.legalRule.count({
        where: {
          legalRuleCatalogVersionId: existingVersion.id,
          status: approvedStatus,
        },
      });
      return {
        id: existingVersion.id,
        version: existingVersion.version,
        status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        corpusVersionId: corpus.id,
        ruleCount,
        noChanges: true,
      };
    }

    const catalog = await this.prisma.$transaction(async (tx) => {
      const created = await tx.legalRuleCatalogVersion.create({
        data: {
          version,
          status: approvedStatus,
          approvedAt: new Date(),
          ruleRefs: candidateChunks.map((chunk) => ({
            legalRuleId: legalRuleIdForChunk(corpus.version, chunk.id),
            legalCorpusVersionId: corpus.id,
            chunkId: chunk.id,
          })),
        },
      });

      await tx.legalRule.createMany({
        data: candidateChunks.map((chunk) => ({
          legalRuleId: legalRuleIdForChunk(corpus.version, chunk.id),
          legalRuleCatalogVersionId: created.id,
          ruleFamily: LEGAL_ENGINEERING_RULE_FAMILY,
          requiredFacts: [
            {
              field: "aiDetected",
              expectedValue: "confirmed",
            },
          ],
          optionalFacts: [],
          blockingFacts: [],
          unknownFactPolicy: LEGAL_UNKNOWN_FACT_POLICY,
          citationLocatorRefs: [
            {
              legalCorpusVersionId: corpus.id,
              documentId: chunk.documentId,
              locator: chunk.locator,
              id: chunk.id,
            },
          ],
          status: approvedStatus,
          authoredBy: LEGAL_RULE_RECOVERY_SERVICE,
        })),
      });

      await tx.ruleApprovalRecord.create({
        data: {
          legalRuleCatalogVersionId: created.id,
          approvedBy: LEGAL_RULE_RECOVERY_SERVICE,
          status: approvedStatus,
          scopeDescription:
            "Automatic recovery from approved legal corpus engineering-rule candidate chunks.",
          comments: `idempotencyKey=${input.idempotencyKey}`,
        },
      });

      return created;
    });

    return {
      id: catalog.id,
      version: catalog.version,
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      corpusVersionId: corpus.id,
      ruleCount: candidateChunks.length,
      noChanges: false,
    };
  }

  private async findLatestApprovedCatalogWithRules(
    approvedStatus: PrismaLegalRuleLifecycleStatus,
  ) {
    const catalogs = await this.prisma.legalRuleCatalogVersion.findMany({
      where: { status: approvedStatus },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: { id: true, version: true },
    });
    for (const catalog of catalogs) {
      const ruleCount = await this.prisma.legalRule.count({
        where: {
          legalRuleCatalogVersionId: catalog.id,
          status: approvedStatus,
        },
      });
      if (ruleCount > 0) {
        return { ...catalog, ruleCount };
      }
    }
    return null;
  }
}

function normativeClass(chunk: {
  hierarchy: Prisma.JsonValue;
  content?: string | null;
  locator?: string | null;
}): string {
  const hierarchy = chunk.hierarchy;
  if (hierarchy && typeof hierarchy === "object" && !Array.isArray(hierarchy)) {
    const raw = (hierarchy as Record<string, unknown>).normativeClass;
    if (typeof raw === "string" && raw.trim()) {
      return normalizeNormativeClass(raw);
    }
  }
  return inferNormativeClass(chunk);
}

function inferNormativeClass(chunk: {
  hierarchy: Prisma.JsonValue;
  content?: string | null;
  locator?: string | null;
}): string {
  const content = normalizeLegalText(chunk.content ?? "");
  if (!content) return LEGAL_EXCLUDE_FROM_DATABASE_CLASS;
  const hierarchy =
    chunk.hierarchy && typeof chunk.hierarchy === "object"
      ? (chunk.hierarchy as Record<string, unknown>)
      : {};
  const articleTitle = normalizeLegalText(
    typeof hierarchy.articleTitle === "string" ? hierarchy.articleTitle : "",
  );
  if (
    LEGAL_CONTEXT_ONLY_ARTICLE_TITLE_TERMS.some((term) =>
      articleTitle.includes(term),
    )
  ) {
    return LEGAL_CONTEXT_ONLY_CLASS;
  }
  if (
    LEGAL_ENGINEERING_OBLIGATION_TERMS.some((term) => content.includes(term))
  ) {
    return LEGAL_ENGINEERING_CANDIDATE_CLASS;
  }
  return LEGAL_CONTEXT_ONLY_CLASS;
}

function normalizeLegalText(value: string): string {
  return value.toLocaleLowerCase("vi").split(/\s+/u).filter(Boolean).join(" ");
}

function normalizeNormativeClass(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLocaleUpperCase("en-US");
  if (normalized === LEGAL_ENGINEERING_CANDIDATE_CLASS) {
    return LEGAL_ENGINEERING_CANDIDATE_CLASS;
  }
  if (normalized === LEGAL_CONTEXT_ONLY_CLASS) {
    return LEGAL_CONTEXT_ONLY_CLASS;
  }
  if (normalized === LEGAL_EXCLUDE_FROM_DATABASE_CLASS) {
    return LEGAL_EXCLUDE_FROM_DATABASE_CLASS;
  }
  return normalized;
}

function sourceDigest(corpusId: string, parts: string[]): string {
  const hash = createHash("sha256");
  hash.update(corpusId);
  for (const part of parts.sort()) {
    hash.update("\n");
    hash.update(part);
  }
  return hash.digest("hex").slice(0, 16).toUpperCase();
}

function legalRuleIdForChunk(corpusVersion: string, chunkId: string): string {
  return `AUTO-${safeIdentifier(corpusVersion)}-${safeIdentifier(chunkId)}`;
}

function safeIdentifier(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}
