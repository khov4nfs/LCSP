import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  customerUsageQuerySchema,
  customerUsageAnalyticsSchema,
} from "@lcsp/contracts/billing";

import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";

/**
 * Business purpose: Proxy customer usage through the shared authenticated and validated BFF boundary.
 * Business rules:
 * - Reject owner/internal filters; the API derives ownership and enforces the customer role.
 * - Only schema-valid public analytics may reach the browser.
 * Execution flow:
 * 1. Require a session, validate and serialize the customer filters.
 * 2. Forward the bearer request and validate the upstream success or preserve its problem.
 * Failure cases:
 * - Invalid filters return validationFailed/400; authentication and upstream failures retain shared policy.
 * Side effects:
 * - One authenticated upstream read; no usage or accounting writes.
 */
export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }
  const query = customerUsageQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  }
  const params = new URLSearchParams(
    Object.entries(query.data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return validatedBillingUpstreamJson(
    await upstreamRequest(`/billing/usage?${params}`, {
      bearerToken: session.token,
    }),
    customerUsageAnalyticsSchema,
  );
}
