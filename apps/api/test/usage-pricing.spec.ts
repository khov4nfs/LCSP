import { describe, expect, it } from "@jest/globals";
import {
  applyMarkup,
  calculateCustomerChargeCredits,
  calculateCustomerChargeVnd,
  calculateUsageChargeCredits,
} from "../src/modules/billing/domain/usage-pricing.js";
import type { PricingRecord } from "../src/modules/billing/domain/repositories/billing-transaction.port.js";

const pricing = {
  id: "p",
  provider: "OPENAI",
  model: "MODEL_A",
  inputPricePerMillion: "1.00000000",
  outputPricePerMillion: "2.00000000",
  version: 1,
  effectiveAt: new Date(),
  providerCurrency: "VND",
  customerCurrency: "VND",
  markupBps: 0n,
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

  it("prices cached, cache-write and reasoning dimensions independently", () => {
    const fullPricing = {
      ...pricing,
      cachedInputPricePerMillion: "0.50000000",
      cacheWritePricePerMillion: "1.50000000",
      reasoningPricePerMillion: "3.00000000",
    };
    expect(
      calculateUsageChargeCredits(
        {
          cachedInputTokens: 1_000_000n,
          cacheWriteTokens: 1_000_000n,
          reasoningTokens: 1_000_000n,
        },
        fullPricing,
      ),
    ).toBe(5n);
  });

  it("prices a canonical cached-input slice without charging it again as full input", () => {
    const cachedPricing = {
      ...pricing,
      cachedInputPricePerMillion: "0.50000000",
    };
    // The adapter has already changed a provider's 1M total input counter into
    // 750k uncached input plus 250k cached input before it reaches billing.
    expect(
      calculateUsageChargeCredits(
        { inputTokens: 750_000n, cachedInputTokens: 250_000n },
        cachedPricing,
      ),
    ).toBe(1n);
  });

  it("does not infer a relationship between independent output and reasoning counters", () => {
    const reasoningPricing = {
      ...pricing,
      reasoningPricePerMillion: "3.00000000",
    };
    expect(
      calculateUsageChargeCredits(
        { outputTokens: 1_000_000n, reasoningTokens: 1_000_000n },
        reasoningPricing,
      ),
    ).toBe(5n);
  });

  it("fails closed when usage has no corresponding snapshot price", () => {
    expect(() =>
      calculateUsageChargeCredits({ cachedInputTokens: 1n }, pricing),
    ).toThrow("required usage dimension price");
  });

  it("applies configured markup with final ceil rounding", () => {
    expect(applyMarkup(100n, 1500n)).toBe(115n);
    expect(applyMarkup(1n, 1n)).toBe(2n);
  });

  it("carries fractional provider cost through non-zero markup before one final round", () => {
    const fractionalPricing = {
      ...pricing,
      inputPricePerMillion: "1.10000000",
      markupBps: 1000n,
    };
    expect(
      calculateCustomerChargeCredits(
        { inputTokens: 1_000_000n },
        fractionalPricing,
      ),
    ).toBe(2n);
  });

  it("uses the markup and FX locked in the selected immutable pricing snapshot", () => {
    const settledSnapshot = {
      ...pricing,
      id: "price-v1",
      providerCurrency: "USD",
      customerCurrency: "VND",
      markupBps: 1000n,
      fxRateVndNumerator: 25_000n,
      fxRateVndDenominator: 1n,
    };
    const successorSnapshot = {
      ...settledSnapshot,
      id: "price-v2",
      markupBps: 0n,
      fxRateVndNumerator: 30_000n,
    };
    const usage = { inputTokens: 1_000_000n };
    const settledCharge = calculateCustomerChargeCredits(
      usage,
      settledSnapshot,
    );
    const successorCharge = calculateCustomerChargeCredits(
      usage,
      successorSnapshot,
    );

    expect(settledCharge).toBe(2n);
    expect(calculateCustomerChargeVnd(usage, settledSnapshot)).toBe(27_500n);
    expect(successorCharge).toBe(1n);
    expect(calculateCustomerChargeVnd(usage, successorSnapshot)).toBe(30_000n);
  });

  it("prices output-only usage from its output dimension", () => {
    expect(
      calculateUsageChargeCredits({ outputTokens: 1_000_000n }, pricing),
    ).toBe(2n);
  });

  it("keeps fractional provider currency through markup and FX", () => {
    const crossCurrency = {
      ...pricing,
      providerCurrency: "USD",
      customerCurrency: "VND",
      inputPricePerMillion: "0.10000000",
      markupBps: 1000n,
      fxRateVndNumerator: 25_000n,
      fxRateVndDenominator: 1n,
    };
    expect(
      calculateCustomerChargeVnd({ inputTokens: 1_000_000n }, crossCurrency),
    ).toBe(2_750n);
  });

  it("rejects legacy pricing snapshots that lack composite settlement authority", () => {
    const legacyPricing: PricingRecord = {
      ...pricing,
      providerCurrency: undefined,
      customerCurrency: undefined,
      markupBps: undefined,
    };
    expect(() =>
      calculateCustomerChargeVnd({ inputTokens: 1n }, legacyPricing),
    ).toThrow();
  });
});
