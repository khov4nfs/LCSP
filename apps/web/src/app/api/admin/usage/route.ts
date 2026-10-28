import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  adminUsageQuerySchema,
  adminUsageAnalyticsSchema,
} from "@lcsp/contracts/billing";
import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";
/**
 * Business purpose: Expose Admin invocation analytics with validated filters and the
 *   canonical billing envelope.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Only adminUsageQuerySchema-normalized filters are forwarded; undefined values are omitted
 *   and success must satisfy adminUsageAnalyticsSchema.
 *
 * Execution flow:
 * 1. Require the session and validate query filters.
 * 2. Serialize normalized filters, request Admin usage and validate the billing result.
 *
 * Failure cases:
 * - Invalid filters return billing validationFailed with HTTP 400; session, upstream and
 *   analytics-schema failures use the shared billing policy.
 *
 * Side effects:
 * - One upstream analytics read; no usage settlement or credit movement.
 */
export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const query = adminUsageQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success)
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  const params = new URLSearchParams(
    Object.entries(query.data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  return validatedBillingUpstreamJson(
    await upstreamRequest(`/admin/usage?${params}`, {
      bearerToken: session.token,
    }),
    adminUsageAnalyticsSchema,
  );
}
