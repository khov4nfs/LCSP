import { Query } from "@nestjs/cqrs";
import type {
  CustomerUsageAnalytics,
  CustomerUsageQuery,
} from "@lcsp/contracts/billing";

export class GetCustomerUsageQuery extends Query<CustomerUsageAnalytics> {
  constructor(
    public readonly userId: string,
    public readonly filters: CustomerUsageQuery,
  ) {
    super();
  }
}
