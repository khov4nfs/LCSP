import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  billingHistoryQuerySchema,
  billingHistoryViewSchema,
} from "@lcsp/contracts/billing";

import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const queryResult = billingHistoryQuerySchema.safeParse({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    page_size: request.nextUrl.searchParams.get("page_size") ?? undefined,
  });
  if (!queryResult.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  }
  const query = new URLSearchParams({
    page: String(queryResult.data.page),
    page_size: String(queryResult.data.page_size),
  });
  return validatedBillingUpstreamJson(
    await upstreamRequest(`/billing/history?${query.toString()}`, {
      bearerToken: session.token,
    }),
    billingHistoryViewSchema,
  );
}
