import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import {
  BILLING_ESTIMATE_AVAILABILITY,
  BILLING_ESTIMATE_RUNTIME_ROLE,
} from "@lcsp/contracts/billing";
import type {
  BillingUsageEstimate,
  PrepaidEstimate,
} from "@lcsp/contracts/billing";
import type { AppConfig } from "../../../../../config/config.types.js";
import { BillingDomainError } from "../../../domain/billing.errors.js";
import { BILLING_TRANSACTION_PORT } from "../../../domain/repositories/billing-transaction.port.js";
import type {
  BillingTransactionPort,
  PricingRecord,
  RuntimeModelPolicyRecord,
} from "../../../domain/repositories/billing-transaction.port.js";
import { calculateCustomerChargeVnd } from "../../../domain/usage-pricing.js";
import { estimatePrepaid } from "../../shared/billing-application.helpers.js";
import { EstimateBillingQuery } from "./estimate-billing.query.js";

@QueryHandler(EstimateBillingQuery)
export class EstimateBillingHandler implements IQueryHandler<EstimateBillingQuery> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async execute(query: EstimateBillingQuery): Promise<BillingUsageEstimate> {
    const prepaid = estimatePrepaid(query.amountVnd);
    const effectiveAt = new Date();
    return this.transactions.runForUser(query.userId, async (repositories) => {
      let runtime: RuntimeModelPolicyRecord | null;
      try {
        runtime = await repositories.runtimePolicy.findApplicable(
          BILLING_ESTIMATE_RUNTIME_ROLE,
          effectiveAt,
        );
      } catch (error) {
        if (error instanceof BillingDomainError)
          return unavailableEstimate(prepaid, null);
        throw error;
      }
      const effectiveRuntimeModel = runtime
        ? {
            provider: runtime.provider,
            model: runtime.model,
            policyVersion: runtime.policyVersion,
            effectiveAt: runtime.effectiveAt.toISOString(),
          }
        : null;
      if (!runtime) return unavailableEstimate(prepaid, null);

      let pricing: PricingRecord | null;
      try {
        pricing = await repositories.pricing.findApplicable(
          runtime.provider,
          runtime.model,
          effectiveAt,
        );
      } catch (error) {
        if (error instanceof BillingDomainError)
          return unavailableEstimate(prepaid, effectiveRuntimeModel);
        throw error;
      }
      const usage = this.referenceUsage();
      if (!pricing || !usage)
        return unavailableEstimate(prepaid, effectiveRuntimeModel);

      try {
        return {
          ...prepaid,
          availability: BILLING_ESTIMATE_AVAILABILITY.available,
          effectiveRuntimeModel,
          estimatedUsageChargeVnd: calculateCustomerChargeVnd(
            usage,
            pricing,
          ).toString(),
        };
      } catch {
        return unavailableEstimate(prepaid, effectiveRuntimeModel);
      }
    });
  }

  private referenceUsage() {
    const billing = this.config.getOrThrow<AppConfig["billing"]>("billing");
    const values = [
      billing.maxInputTokens,
      billing.maxOutputTokens,
      billing.maxReasoningTokens,
    ];
    if (values.some((value) => !/^\d+$/.test(value))) return null;
    const [inputTokens, outputTokens, reasoningTokens] = values.map((value) =>
      BigInt(value),
    );
    if (inputTokens === 0n && outputTokens === 0n && reasoningTokens === 0n)
      return null;
    return { inputTokens, outputTokens, reasoningTokens };
  }
}

function unavailableEstimate(
  prepaid: PrepaidEstimate,
  effectiveRuntimeModel: BillingUsageEstimate["effectiveRuntimeModel"],
): BillingUsageEstimate {
  return {
    ...prepaid,
    availability:
      BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration,
    effectiveRuntimeModel,
    estimatedUsageChargeVnd: null,
  };
}
