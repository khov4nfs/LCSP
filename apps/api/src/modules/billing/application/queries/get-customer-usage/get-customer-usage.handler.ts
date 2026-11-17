import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  CUSTOMER_USAGE_DIMENSIONS,
  customerUsageAnalyticsSchema,
  customerUsageQuerySchema,
  type CustomerUsageAnalytics,
} from "@lcsp/contracts/billing";

import { UsageAnalyticsReader } from "../../shared/usage-analytics.reader.js";
import { GetCustomerUsageQuery } from "./get-customer-usage.query.js";

@QueryHandler(GetCustomerUsageQuery)
export class GetCustomerUsageHandler implements IQueryHandler<GetCustomerUsageQuery> {
  constructor(private readonly reader: UsageAnalyticsReader) {}

  /**
   * Business purpose: Show a customer only their own persisted model usage and reference estimates.
   * Business rules:
   * - The authenticated owner is mandatory and cannot be overridden by query filters.
   * - System-owned receipts are excluded; workflow IDs, failures and pricing internals are not public.
   * Execution flow:
   * 1. Validate the bounded customer filters and require a nonempty authenticated owner.
   * 2. Apply the owner to both aggregates and receipt pagination through the shared reader.
   * 3. Retain public breakdowns and strip internal receipt and pricing fields using the customer schema.
   * Failure cases:
   * - Missing ownership, invalid filters or stored data reject rather than reading all accounts.
   * Side effects:
   * - Read-only database snapshot; no wallet, ledger or usage changes.
   */
  async execute(query: GetCustomerUsageQuery): Promise<CustomerUsageAnalytics> {
    if (!query.userId.trim()) {
      throw new Error("Customer usage requires an authenticated owner");
    }
    const filters = customerUsageQuerySchema.parse(query.filters);
    const report = await this.reader.read({ ...filters, userId: query.userId });
    return customerUsageAnalyticsSchema.parse({
      ...report,
      breakdowns: report.breakdowns.filter((row) =>
        Object.values(CUSTOMER_USAGE_DIMENSIONS).some(
          (dimension) => dimension === row.dimension,
        ),
      ),
    });
  }
}
