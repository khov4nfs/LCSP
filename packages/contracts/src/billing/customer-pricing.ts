import { z } from "zod";

export const CUSTOMER_USAGE_PRICING = {
  version: "lcsp-usage-1.8-v1",
  multiplier: "1.8",
  numerator: "18",
  denominator: "10",
} as const;

export const customerUsageSellingPriceSchema = z.object({
  version: z.literal(CUSTOMER_USAGE_PRICING.version),
  multiplier: z.literal(CUSTOMER_USAGE_PRICING.multiplier),
  knownSubtotalUsd: z.string().regex(/^\d+(\.\d+)?$/),
  estimatedTotalUsd: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .nullable(),
});

/**
 * Business purpose: Quote LCSP usage at 1.8 times the provider reference cost independently of cost evidence.
 * Business rules:
 * - Preserve exact decimal USD using integer arithmetic; unknown full costs remain unknown.
 * - This versioned quote is informational and never establishes a wallet debit or historical charge.
 * Execution flow:
 * 1. Validate the nonnegative reference subtotal and multiply its integer digits by the policy numerator.
 * 2. Account for the decimal denominator and format the exact selling subtotal.
 * 3. Publish a full selling estimate only when the reference estimate is complete.
 * Failure cases:
 * - Invalid decimal reference amounts throw rather than publishing a fabricated quote.
 * Side effects:
 * - Pure calculation; provider snapshots, wallets and ledgers remain unchanged.
 */
export function quoteCustomerUsage(
  knownCostUsd: string,
  estimatedCostUsd: string | null,
) {
  if (!/^\d+(\.\d+)?$/.test(knownCostUsd)) {
    throw new Error("Invalid reference cost decimal");
  }
  const [whole, fraction = ""] = knownCostUsd.split(".");
  const digits = (
    BigInt(whole + fraction) * BigInt(CUSTOMER_USAGE_PRICING.numerator)
  )
    .toString()
    .padStart(fraction.length + 2, "0");
  const scale = fraction.length + CUSTOMER_USAGE_PRICING.denominator.length - 1;
  const decimal = digits.slice(-scale).replace(/0+$/, "");
  const subtotal = digits.slice(0, -scale) + (decimal ? `.${decimal}` : "");
  return {
    version: CUSTOMER_USAGE_PRICING.version,
    multiplier: CUSTOMER_USAGE_PRICING.multiplier,
    knownSubtotalUsd: subtotal,
    estimatedTotalUsd: estimatedCostUsd === null ? null : subtotal,
  };
}
