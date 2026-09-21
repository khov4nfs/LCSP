import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  billingAmountVndSchema,
  billingUsageEstimateSchema,
} from "@lcsp/contracts/billing";

import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const amountVndResult = billingAmountVndSchema.safeParse(
    request.nextUrl.searchParams.get("amount_vnd"),
  );
  if (!amountVndResult.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  }
  const query = `?amount_vnd=${encodeURIComponent(amountVndResult.data)}`;

  return validatedBillingUpstreamJson(
    await upstreamRequest(`/billing/estimate${query}`, {
      bearerToken: session.token,
    }),
    billingUsageEstimateSchema,
  );
}
