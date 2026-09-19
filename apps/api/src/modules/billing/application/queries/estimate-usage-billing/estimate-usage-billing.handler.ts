import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import {
  calculateCustomerChargeCredits,
  calculateCustomerChargeVnd,
  calculateUsageChargeCredits,
} from "../../../domain/usage-pricing.js";
import { EstimateUsageBillingQuery } from "./estimate-usage-billing.query.js";

@QueryHandler(EstimateUsageBillingQuery)
export class EstimateUsageBillingHandler implements IQueryHandler<EstimateUsageBillingQuery> {
  execute(query: EstimateUsageBillingQuery) {
    const { runtimeModel, usage, pricing } = query.input;
    return Promise.resolve({
      isEstimate: true as const,
      provider: runtimeModel.provider,
      model: runtimeModel.model,
      policyVersion: runtimeModel.policyVersion,
      providerCostCredits: calculateUsageChargeCredits(usage, pricing),
      customerChargeCredits: calculateCustomerChargeCredits(usage, pricing),
      customerChargeVnd: calculateCustomerChargeVnd(usage, pricing),
    });
  }
}
