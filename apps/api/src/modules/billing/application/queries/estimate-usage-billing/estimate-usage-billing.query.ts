import { Query } from "@nestjs/cqrs";
import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";
import type { PricingRecord } from "../../../domain/repositories/billing-transaction.port.js";
import type { UsageDimensions } from "../../../domain/usage-pricing.js";

export type EstimateUsageBillingInput = {
  runtimeModel: EffectiveRuntimeModel;
  usage: UsageDimensions;
  pricing: PricingRecord;
};

export class EstimateUsageBillingQuery extends Query<unknown> {
  constructor(public readonly input: EstimateUsageBillingInput) {
    super();
  }
}
