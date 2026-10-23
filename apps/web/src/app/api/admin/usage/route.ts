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
