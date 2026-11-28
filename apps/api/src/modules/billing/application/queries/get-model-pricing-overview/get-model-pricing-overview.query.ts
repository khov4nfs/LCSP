import { Query } from "@nestjs/cqrs";
import type {
  AdminModelPricingOverviewQuery,
  AdminModelPricingOverviewResponse,
} from "@lcsp/contracts/billing";

export class GetModelPricingOverviewQuery extends Query<AdminModelPricingOverviewResponse> {
  constructor(public readonly input: AdminModelPricingOverviewQuery = {}) {
    super();
  }
}
