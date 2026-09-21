import { Query } from "@nestjs/cqrs";
import type { BillingAdminDashboard } from "@lcsp/contracts/billing";
import type { BillingAdminDashboardQuery } from "@lcsp/contracts/billing";

export class GetBillingAdminDashboardQuery extends Query<BillingAdminDashboard> {
  constructor(
    public readonly input: BillingAdminDashboardQuery,
    public readonly now?: Date,
  ) {
    super();
  }
}
