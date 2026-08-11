import { createHash } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import { Prisma } from "@prisma/client";

import { toPrismaLegalRuleLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import type {
  IngestLegalCorpusRequest,
  LegalCorpusDocumentInput,
} from "../contracts/legal-corpus.contract.js";

const INDEPENDENT_AUDIT_PRINCIPAL_POLICY =
  "TECHNICAL_AUDIT_PRINCIPALS_INDEPENDENT";

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
  constructor(private readonly prisma: PrismaService) {}

  async ingestDraft(input: IngestLegalCorpusRequest) {
    this.validateIngest(input);

    const existing = await this.prisma.legalCorpusVersion.findUnique({
      where: { version: input.version },
      select: { id: true },
    });
    if (existing) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        "legal-corpus-ingest",
        { status: HttpStatus.CONFLICT, meta: { version: input.version } },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const corpus = await tx.legalCorpusVersion.create({
        data: {
          version: input.version,
          sourceManifest: input.sourceManifest as Prisma.InputJsonValue,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.draft,
          ),
        },
      });

      for (const document of input.documents) {
        await this.createDocument(tx, corpus.id, document);
      }

      return {
        id: corpus.id,
        version: corpus.version,
        status: LEGAL_RULE_LIFECYCLE_STATUSES.draft,
        documentCount: input.documents.length,
        chunkCount: input.documents.reduce(
          (count, document) => count + document.chunks.length,
          0,
        ),
      };
    });
  }

  async approveDraft(input: {
    corpusVersionId: string;
    approvedBy: string;
    scopeDescription: string;
    comments: string | null;
    correlationId: string;
  }) {
    const corpus = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: input.corpusVersionId },
      include: { documents: { include: { chunks: true } } },
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
        { status: HttpStatus.CONFLICT },
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

    const reviewSignoff = this.requireApprovedReviewSignoff(
      corpus.sourceManifest,
      corpus.documents.map((document) => ({
        documentId: document.documentId,
        sourceSha256: document.sourceSha256,
      })),
      input.correlationId,
    );
    if (
      reviewSignoff.reviewedBy !== input.approvedBy &&
      !reviewSignoff.approvalActorMayDiffer
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            reason: "legal_operator_identity_mismatch",
            signoffReviewedBy: reviewSignoff.reviewedBy,
          },
        },
      );
    }

    const approvedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.legalCorpusVersion.update({
        where: { id: corpus.id },
        data: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          approvedAt,
        },
      });
      await tx.corpusApprovalRecord.create({
        data: {
          legalCorpusVersionId: corpus.id,
          approvedBy: input.approvedBy,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          scopeDescription: input.scopeDescription,
          comments: input.comments,
          approvalDate: approvedAt,
        },
      });
    });

    return {
      id: corpus.id,
      version: corpus.version,
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      approvedAt: approvedAt.toISOString(),
    };
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

    if (!isRecord(sourceManifest) || sourceManifest.reviewRequired !== true) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
