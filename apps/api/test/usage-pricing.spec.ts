import { describe, expect, it } from "@jest/globals";
import { calculateUsageChargeCredits } from "../src/modules/billing/domain/usage-pricing.js";
import type { PricingRecord } from "../src/modules/billing/domain/repositories/billing-transaction.port.js";

const pricing = {
  id: "p",
  provider: "OPENAI",
  model: "MODEL_A",
  inputPricePerMillion: "1.00000000",
  outputPricePerMillion: "2.00000000",
  version: 1,
  effectiveAt: new Date(),
} satisfies PricingRecord;

describe("usage pricing", () => {
  it("uses exact arithmetic and rounds the total charge up once", () => {
    expect(calculateUsageChargeCredits(1_000_000n, 500_000n, pricing)).toBe(2n);
    expect(calculateUsageChargeCredits(200_000n, 100_000n, pricing)).toBe(1n);
    expect(calculateUsageChargeCredits(1n, 0n, pricing)).toBe(1n);
  });

  it("rejects negative usage", () => {
    expect(() => calculateUsageChargeCredits(-1n, 0n, pricing)).toThrow();
  });
});
