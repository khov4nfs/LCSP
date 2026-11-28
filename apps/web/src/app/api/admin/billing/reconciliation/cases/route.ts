import "server-only";

import type { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  billingAdminReconciliationCaseListQuerySchema,
} from "@lcsp/contracts/billing";
import { adminModelReconciliationListSchema } from "@/features/admin/schemas/admin-model-reconciliation.schema";
import { readAdminModelReconciliation } from "@/lib/server/admin-model-reconciliation-upstream";
import { problemJson } from "@/lib/server/problem-json";

/**
 * Business purpose: Expose the read-only Admin model invocation reconciliation queue.
 * Business rules:
 * - Reject unknown filters and require an authenticated session; NestJS enforces Admin RBAC.
 * Execution flow:
 * 1. Validate the complete query string against the shared billing filter contract.
 * 2. Forward normalized filters through the shared authenticated upstream helper.
 * 3. Validate the paginated queue payload before returning it to the browser.
 * Failure cases:
 * - Malformed filters yield 400; auth and upstream failures retain standard problem envelopes.
 * Side effects:
 * - One read-only API call; no reconciliation decision or wallet mutation.
 */
export async function GET(request: NextRequest) {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = billingAdminReconciliationCaseListQuerySchema.strict().safeParse(raw);
  if (!parsed.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, {
      status: 400,
      correlationId: request.headers.get("x-correlation-id")?.trim() || crypto.randomUUID(),
    });
  }
  // Why: Only contract-approved filters may reach the Admin billing API.
  // How: Serialize Zod's defaults and optional filters after strict validation.
  // Invariant: The caller cannot widen the queue query with unrecognized parameters.
  const query = new URLSearchParams(
    Object.entries(parsed.data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return readAdminModelReconciliation(
    request,
    `/admin/billing/reconciliation/cases?${query.toString()}`,
    adminModelReconciliationListSchema,
  );
}
