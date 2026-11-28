import "server-only";

import type { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  billingReconciliationCaseDetailResponseSchema,
} from "@lcsp/contracts/billing";
import { readAdminModelReconciliation } from "@/lib/server/admin-model-reconciliation-upstream";
import { problemJson } from "@/lib/server/problem-json";

/**
 * Business purpose: Expose one Admin model reconciliation case and its linked evidence for inspection.
 * Business rules:
 * - Case IDs must be bounded opaque identifiers; NestJS decides Admin authorization and case existence.
 * Execution flow:
 * 1. Await the Next.js route parameter and validate its shape.
 * 2. Encode it as one URL segment and request the case through the shared BFF helper.
 * 3. Return only a payload matching the shared detail contract.
 * Failure cases:
 * - Invalid IDs yield 400; missing/unauthorized cases retain upstream problem status.
 * Side effects:
 * - One read-only API call; no case decision or settlement operation.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  if (!caseId || caseId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(caseId)) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, {
      status: 400,
      correlationId: request.headers.get("x-correlation-id")?.trim() || crypto.randomUUID(),
    });
  }
  // Why: An opaque ID must stay inside one upstream route segment.
  // How: Validate its character set and encode before building the API path.
  // Invariant: No path traversal or query injection can expand the case read scope.
  return readAdminModelReconciliation(
    request,
    `/admin/billing/reconciliation/cases/${encodeURIComponent(caseId)}`,
    billingReconciliationCaseDetailResponseSchema,
  );
}
