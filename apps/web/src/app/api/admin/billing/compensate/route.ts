import type { NextRequest } from "next/server";
import {
  compensateBillingDebitRequestSchema,
  compensateBillingDebitResponseSchema,
} from "@lcsp/contracts/billing";
import { mutateAdminModelReconciliation } from "@/lib/server/admin-model-reconciliation-upstream";

/**
 * Business purpose: Relay a bounded Admin compensation request to the billing authority.
 * Business rules:
 * - Input follows the strict debit-linked contract; NestJS checks compensation permission.
 * Execution flow:
 * 1. Validate session and body. 2. Forward with correlation. 3. Validate response.
 * Failure cases:
 * - Invalid data, missing session or upstream problems return the canonical envelope.
 * Side effects:
 * - May write a compensation ledger entry through the upstream billing API.
 */
export async function POST(request: NextRequest) {
  // Why: Financial correction must use the canonical billing contract and shared BFF transport.
  // How: Send only schema-approved fields to the protected API route.
  // Invariant: The BFF cannot manufacture a wallet balance or claim Admin authority.
  return mutateAdminModelReconciliation(
    request,
    "/admin/billing/compensate",
    compensateBillingDebitRequestSchema,
    compensateBillingDebitResponseSchema,
  );
}
