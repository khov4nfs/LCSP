import { Query } from "@nestjs/cqrs";
import type {
  AdminUsageAnalytics,
  AdminUsageQuery,
} from "@lcsp/contracts/billing";
export class GetAdminUsageQuery extends Query<AdminUsageAnalytics> {
  constructor(public readonly filters: AdminUsageQuery) {
    super();
  }
}
