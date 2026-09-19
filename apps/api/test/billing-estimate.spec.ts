import { describe, expect, it } from "@jest/globals";
import { EstimateUsageBillingHandler } from "../src/modules/billing/application/queries/estimate-usage-billing/estimate-usage-billing.handler.js";
import { EstimateUsageBillingQuery } from "../src/modules/billing/application/queries/estimate-usage-billing/estimate-usage-billing.query.js";

describe("billing estimates", () => {
  it("is explicitly informational and computes without accounting", async () => {
    const result = await new EstimateUsageBillingHandler().execute(
      new EstimateUsageBillingQuery({
        runtimeModel: {
          provider: "openai",
          model: "gpt-test",
          policyVersion: "p1",
          effectiveAt: new Date().toISOString(),
        },
        usage: { inputTokens: 1_000_000n },
        pricing: {
          id: "price",
          provider: "openai",
          model: "gpt-test",
          inputPricePerMillion: "1",
          outputPricePerMillion: "2",
          version: 1,
          effectiveAt: new Date(),
          providerCurrency: "VND",
          customerCurrency: "VND",
          markupBps: 1000n,
        },
      }),
    );
    expect(result.isEstimate).toBe(true);
    expect(result.providerCostCredits).toBe(1n);
    expect(result.customerChargeCredits).toBe(2n);
  });
});
