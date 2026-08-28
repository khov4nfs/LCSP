import { AUDIT_ERROR_CODES } from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import { fromPrismaAuthDecision } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  AuditEventListDto,
  AuditEventSummary,
} from "../../contracts/audit/audit-event-list.contract.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { ListAuditEventsQuery } from "./list-audit-events.query.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_DATE_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;

/**
 * Lists audit events with bounded pagination/date filters and redacted payloads.
 */
@QueryHandler(ListAuditEventsQuery)
export class ListAuditEventsHandler implements IQueryHandler<ListAuditEventsQuery> {
  /**
   * Creates the list handler with audit persistence and payload redaction dependencies.
   *
   * @param prisma - Prisma service used for filtered AuditEvent queries.
   * @param redactor - Service used to remove sensitive audit payload content before response serialization.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly redactor: AuditRedactorService,
  ) {}

  /**
   * Validates filter inputs, retrieves a page of audit events, and redacts each payload.
   *
   * @param query - Filters, pagination, and correlation context for the audit list request.
   * @returns Paginated audit event summaries with sanitized payloads.
   * @throws When pagination, date syntax, or date-range constraints are invalid.
   */
  async execute(query: ListAuditEventsQuery): Promise<AuditEventListDto> {
    const page = this.positiveInteger(
      query.page,
      DEFAULT_PAGE,
      query.correlationId,
    );
    const requestedPageSize = this.positiveInteger(
      query.pageSize,
      DEFAULT_PAGE_SIZE,
      query.correlationId,
    );
    const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
    const fromDate = this.parseDate(
      query.fromDate,
      "from_date",
      query.correlationId,
    );
    const toDate = this.parseDate(query.toDate, "to_date", query.correlationId);

    if (fromDate && toDate) {
      const range = toDate.getTime() - fromDate.getTime();
      if (range < 0) {
        this.badRequest(
          AUDIT_ERROR_CODES.invalidDateRange,
          query.correlationId,
        );
      }
      if (range > MAX_DATE_RANGE_MS) {
        this.badRequest(
          AUDIT_ERROR_CODES.dateRangeExceeded,
          query.correlationId,
        );
      }
    }

    const where: Prisma.AuditEventWhereInput = {
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          eventType: true,
          actorId: true,
          decision: true,
          payload: true,
          createdAt: true,
        },
      }),
    ]);

    const events: AuditEventSummary[] = rows.map((row) => ({
      event_id: row.id,
      event_type: row.eventType,
      actor_id: row.actorId,
      decision: row.decision ? fromPrismaAuthDecision(row.decision) : null,
      payload: this.redactor.redact(row.payload),
      occurred_at: row.createdAt.toISOString(),
    }));

    return {
      events,
      total,
      page,
      page_size: pageSize,
      correlationId: query.correlationId,
    };
  }

  /**
   * Resolves an optional positive-integer query parameter with a fallback default.
   *
   * @param value - Optional numeric query value.
   * @param fallback - Value used when the caller omitted the parameter.
   * @param correlationId - Correlation identifier attached to validation errors.
   * @returns The validated positive integer or fallback.
   * @throws An invalid-query problem when a supplied value is not a positive integer.
   */
  private positiveInteger(
    value: number | undefined,
    fallback: number,
    correlationId: string,
  ): number {
    if (value === undefined) {
      return fallback;
    }
    if (!Number.isInteger(value) || value < 1) {
      this.badRequest(AUDIT_ERROR_CODES.invalidQuery, correlationId);
    }
    return value;
  }

  /**
   * Parses an optional date filter while preserving omission as undefined.
   *
   * @param value - Optional raw date string.
   * @param field - Request field name reported for invalid input.
   * @param correlationId - Correlation identifier attached to validation errors.
   * @returns Parsed date, or undefined when the filter was omitted.
   * @throws An invalid-query problem when a supplied date cannot be parsed.
   */
  private parseDate(
    value: string | undefined,
    field: string,
    correlationId: string,
  ): Date | undefined {
    if (value === undefined) {
      return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      this.badRequest(AUDIT_ERROR_CODES.invalidQuery, correlationId, field);
    }
    return date;
  }

  /**
   * Throws a standardized bad-request problem for audit query validation failures.
   *
   * @param errorCode - Stable audit or organization-scope error code.
   * @param correlationId - Correlation identifier attached to the problem response.
   * @param field - Optional invalid field name exposed in problem metadata.
   * @throws Always throws the constructed bad-request problem.
   */
  private badRequest(
    errorCode: string,
    correlationId: string,
    field?: string,
  ): never {
    throw problemException(errorCode, correlationId, {
      status: HttpStatus.BAD_REQUEST,
      ...(field ? { meta: { field } } : {}),
    });
  }
}
