import { Injectable } from "@nestjs/common";
import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";
import {
  calculateUsageChargeCredits,
  calculateCustomerChargeCredits,
  calculateCustomerChargeVnd,
  type UsageDimensions,
} from "../../domain/usage-pricing.js";
import type { PricingRecord } from "../../domain/repositories/billing-transaction.port.js";

@Injectable()
export class BillingEstimateService {
  estimate(input: {
    runtimeModel: EffectiveRuntimeModel;
    usage: UsageDimensions;
    pricing: PricingRecord;
  }) {
    const providerCostCredits = calculateUsageChargeCredits(
      input.usage,
      input.pricing,
    );
    const customerChargeCredits = calculateCustomerChargeCredits(
      input.usage,
      input.pricing,
    );
    return {
      isEstimate: true as const,
      provider: input.runtimeModel.provider,
      model: input.runtimeModel.model,
      policyVersion: input.runtimeModel.policyVersion,
      providerCostCredits,
      customerChargeCredits,
      customerChargeVnd: calculateCustomerChargeVnd(input.usage, input.pricing),
    };
  }
}
