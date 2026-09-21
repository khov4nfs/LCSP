import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  billingOrderViewSchema,
  billingResourceIdSchema,
} from "@lcsp/contracts/billing";

import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id } = await context.params;
  const idResult = billingResourceIdSchema.safeParse(id);
  if (!idResult.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  }

  return validatedBillingUpstreamJson(
    await upstreamRequest(
      `/billing/orders/${encodeURIComponent(idResult.data)}`,
      {
        bearerToken: session.token,
      },
    ),
    billingOrderViewSchema,
  );
}
