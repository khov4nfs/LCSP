import { Query } from "@nestjs/cqrs";

import type { AuditEventListDto } from "../../contracts/audit/audit-event-list.contract.js";

/**
 * Requests a paginated audit event list with optional event, actor, and date filters.
 */
export class ListAuditEventsQuery extends Query<AuditEventListDto> {
  /**
   * Creates the audit-event list query.
   *
   * @param eventType - Optional event-type filter.
   * @param actorId - Optional actor identifier filter.
   * @param fromDate - Optional inclusive date-range start.
   * @param toDate - Optional inclusive date-range end.
   * @param page - Optional 1-based page number.
   * @param pageSize - Optional page size.
   * @param correlationId - Correlation identifier propagated to validation errors and response metadata.
   */
  constructor(
    public readonly eventType: string | undefined,
    public readonly actorId: string | undefined,
    public readonly fromDate: string | undefined,
    public readonly toDate: string | undefined,
    public readonly page: number | undefined,
    public readonly pageSize: number | undefined,
    public readonly correlationId: string,
  ) {
    super();
  }
}
