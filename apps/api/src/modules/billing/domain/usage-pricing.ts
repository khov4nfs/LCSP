import { BillingDomainError } from "./billing.errors.js";
import type { PricingRecord } from "./repositories/billing-transaction.port.js";

export function calculateUsageChargeCredits(
  inputTokens: bigint,
  outputTokens: bigint,
  pricing: PricingRecord,
): bigint {
  if (inputTokens < 0n || outputTokens < 0n)
    throw new BillingDomainError("Token counts cannot be negative");
  const scale = 100000000n;
  const parse = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * scale + BigInt(fraction.padEnd(8, "0").slice(0, 8));
  };
  const numerator =
    inputTokens * parse(pricing.inputPricePerMillion) +
    outputTokens * parse(pricing.outputPricePerMillion);
  const denominator = 1_000_000n * scale;
  return (numerator + denominator - 1n) / denominator;
}
