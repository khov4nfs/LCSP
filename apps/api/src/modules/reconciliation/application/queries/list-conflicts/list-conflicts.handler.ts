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
  ConflictListDto,
  ConflictStatus,
  ConflictSummary,
} from "../../contracts/reconciliation/conflict-list.contract.js";
import { ListConflictsQuery } from "./list-conflicts.query.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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
