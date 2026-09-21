import { NextRequest } from "next/server";
import { billingWalletViewSchema } from "@lcsp/contracts/billing";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  return validatedBillingUpstreamJson(
    await upstreamRequest("/billing/wallet", {
      bearerToken: session.token,
    }),
    billingWalletViewSchema,
  );
}
