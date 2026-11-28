import type { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  reconciliationCaseDecisionRequestSchema,
  reconciliationCaseDecisionResponseSchema,
} from "@lcsp/contracts/billing";
import { mutateAdminModelReconciliation } from "@/lib/server/admin-model-reconciliation-upstream";
import { problemJson } from "@/lib/server/problem-json";

/**
 * Business purpose: Relay one audited Admin reconciliation decision to the billing authority.
 * Business rules:
 * - Case IDs are opaque single segments; the API enforces Admin action permission.
 * Execution flow:
 * 1. Validate the route ID. 2. Validate the body and forward it with correlation.
 * Failure cases:
 * - Invalid IDs or bodies return 400; API failures retain their problem status.
 * Side effects:
 * - May change one reconciliation case and its wallet slot through the upstream API.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  if (!caseId || caseId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(caseId)) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, {
      status: 400,
      correlationId:
        request.headers.get("x-correlation-id")?.trim() || crypto.randomUUID(),
    });
  }
  // Why: The selected case ID must not escape its route segment or influence another resource.
  // How: Bound and encode it before invoking the shared mutation helper.
  // Invariant: The API still checks Admin permission and case authority.
  return mutateAdminModelReconciliation(
    request,
    `/admin/billing/reconciliation/cases/${encodeURIComponent(caseId)}/decide`,
    reconciliationCaseDecisionRequestSchema,
    reconciliationCaseDecisionResponseSchema,
  );
}
