import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { UsageAnalyticsReader } from "../../shared/usage-analytics.reader.js";
import { GetAdminUsageQuery } from "./get-admin-usage.query.js";

@QueryHandler(GetAdminUsageQuery)
export class GetAdminUsageHandler implements IQueryHandler<GetAdminUsageQuery> {
  constructor(private readonly reader: UsageAnalyticsReader) {}

  /**
   * Business purpose: Retain the authorized Admin analytics report through the shared reader.
   * Business rules:
   * - Admin authorization stays at the HTTP boundary; existing filters and projections remain intact.
   * Execution flow:
   * 1. Delegate validated Admin filters to the consistent analytics snapshot reader.
   * Failure cases:
   * - Read and stored-snapshot failures propagate without returning fabricated zero usage.
   * Side effects:
   * - Read-only analytics transaction; no billing or usage mutation.
   */
  execute(query: GetAdminUsageQuery) {
    return this.reader.read(query.filters);
  }
}
