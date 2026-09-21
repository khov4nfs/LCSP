import type { PrepaidEstimate } from "@lcsp/contracts/billing";
import { PREPAID_BILLING_CONFIG } from "@lcsp/contracts/billing";
import { InvalidBillingInputError } from "./billing.errors.js";

export function estimatePrepaid(amountVnd: bigint): PrepaidEstimate {
  const minimumAmountVnd = BigInt(PREPAID_BILLING_CONFIG.minimumAmountVnd);
  const maximumAmountVnd = BigInt(PREPAID_BILLING_CONFIG.maximumAmountVnd);
  const amountStepVnd = BigInt(PREPAID_BILLING_CONFIG.amountStepVnd);
  const creditUnitsPerVnd = BigInt(PREPAID_BILLING_CONFIG.creditUnitsPerVnd);
  if (
    amountVnd < minimumAmountVnd ||
    amountVnd > maximumAmountVnd ||
    amountVnd % amountStepVnd !== 0n
  )
    throw new InvalidBillingInputError("Invalid prepaid amount");
  return {
    currency: PREPAID_BILLING_CONFIG.currency,
    amountVnd: amountVnd.toString(),
    creditUnits: (amountVnd * creditUnitsPerVnd).toString(),
    expiresInHours: PREPAID_BILLING_CONFIG.orderExpiryHours,
  };
}
