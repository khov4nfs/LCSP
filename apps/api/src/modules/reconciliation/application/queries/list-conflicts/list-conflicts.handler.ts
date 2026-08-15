import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaConflictRecordStatus,
  toPrismaConflictRecordStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  ConflictEvidenceContext,
  ConflictExplanationBasis,
  ConflictListDto,
  ConflictStatus,
  ConflictSummary,
} from "../../contracts/reconciliation/conflict-list.contract.js";
import { ListConflictsQuery } from "./list-conflicts.query.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SCORE_PRIORITY_EXPLANATION =
  "This score prioritizes Manager review effort and is not a legal risk, compliance status, or final classification.";
const DEFAULT_REDACTED_CONTEXT =
  "Only redacted evidence context is available for this conflict.";
const DEFAULT_COVERAGE_LIMITATIONS =
  "Evidence references identify the supporting findings only and do not provide legal risk, compliance status, or final classification.";

@QueryHandler(ListConflictsQuery)
export class ListConflictsHandler implements IQueryHandler<ListConflictsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListConflictsQuery): Promise<ConflictListDto> {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const status =
      query.status === undefined || query.status.trim() === ""
        ? CONFLICT_RECORD_STATUSES.pending
        : query.status.trim();

    if (!isKnownConflictStatus(status)) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        query.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: query.assessmentId,
        organizationId: query.organizationId,
      },
      select: { id: true },
    });

    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const where = {
      assessmentId: query.assessmentId,
      organizationId: query.organizationId,
      status: toPrismaConflictRecordStatus(status),
    };

    const [items, total] = await Promise.all([
      this.prisma.conflictRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.conflictRecord.count({ where }),
    ]);

    const conflicts: ConflictSummary[] = items.map((item) => ({
      conflict_id: item.id,
      conflict_type: item.conflictType,
      conflict_score: item.conflictScore,
      score_explanation: item.scoreExplanation,
      explanation_basis: normalizeExplanationBasis(
        item.explanationBasis,
        item.conflictType,
        item.evidenceRefs,
      ),
      status: fromPrismaConflictRecordStatus(item.status),
      evidence_refs: evidenceRefsOnly(item.evidenceRefs),
      created_at: item.createdAt.toISOString(),
    }));

    return {
      conflicts,
      total,
      page,
      page_size: pageSize,
      correlationId: query.correlationId,
    };
  }
}

function normalizePage(page: number | undefined): number {
  return Number.isFinite(page)
    ? Math.max(DEFAULT_PAGE, page as number)
    : DEFAULT_PAGE;
}

function normalizePageSize(pageSize: number | undefined): number {
  return Number.isFinite(pageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize as number))
    : DEFAULT_PAGE_SIZE;
}

function isKnownConflictStatus(status: string): status is ConflictStatus {
  return Object.values(CONFLICT_RECORD_STATUSES).some(
    (knownStatus) => knownStatus === status,
  );
}

function evidenceRefsOnly(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeExplanationBasis(
  value: unknown,
  conflictType: string,
  evidenceRefs: unknown,
): ConflictExplanationBasis {
  const basis = isRecord(value) ? value : {};
  const sourceValues = isRecord(basis.source_values) ? basis.source_values : {};

  return {
    affected_field: readString(basis.affected_field, "not_provided"),
    confidence: readString(basis.confidence, "unknown"),
    materiality_reason: readString(
      basis.materiality_reason,
      materialityReasonForType(conflictType),
    ),
    score_priority_explanation: readString(
      basis.score_priority_explanation,
      SCORE_PRIORITY_EXPLANATION,
    ),
    source_values: {
      manager_answer: readNullableString(sourceValues.manager_answer),
      technical_evidence: readNullableString(sourceValues.technical_evidence),
    },
    source_refs: readStringRecord(basis.source_refs),
    evidence_context: normalizeEvidenceContext(
      basis.evidence_context,
      evidenceRefsOnly(evidenceRefs),
    ),
  };
}

function normalizeEvidenceContext(
  value: unknown,
  evidenceRefs: string[],
): ConflictEvidenceContext[] {
  if (Array.isArray(value)) {
    const contexts = value
      .map((item) => {
        if (!isRecord(item)) return null;
        const evidenceRef = readNullableString(item.evidence_ref);
        if (!evidenceRef) return null;
        return {
          evidence_ref: evidenceRef,
          redacted_context: readString(
            item.redacted_context,
            DEFAULT_REDACTED_CONTEXT,
          ),
          coverage_limitations: readString(
            item.coverage_limitations,
            DEFAULT_COVERAGE_LIMITATIONS,
          ),
        };
      })
      .filter((item): item is ConflictEvidenceContext => item !== null);
    if (contexts.length > 0) {
      return contexts;
    }
  }

  return evidenceRefs.map((evidenceRef) => ({
    evidence_ref: evidenceRef,
    redacted_context: DEFAULT_REDACTED_CONTEXT,
    coverage_limitations: DEFAULT_COVERAGE_LIMITATIONS,
  }));
}

function materialityReasonForType(conflictType: string): string {
  if (conflictType === "evidence_contradiction") {
    return "Manager answers and technical evidence differ on a material AI usage claim.";
  }
  if (conflictType === "scope_mismatch") {
    return "Manager answers and technical evidence differ on the role or scope of AI use.";
  }
  if (conflictType === "unverifiable") {
    return "The claim needs review because supporting evidence has limited coverage.";
  }
  return "The AI usage profile and Manager-provided answers differ on a material review point.";
}

function readString(value: unknown, fallback: string): string {
  return readNullableString(value) ?? fallback;
}

function readNullableString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, readNullableString(entry)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
