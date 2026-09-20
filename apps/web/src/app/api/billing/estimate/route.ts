import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const amountVnd = request.nextUrl.searchParams.get("amount_vnd")?.trim();
  const query = amountVnd ? `?amount_vnd=${encodeURIComponent(amountVnd)}` : "";

  return upstreamJson(
    await upstreamRequest(`/billing/estimate${query}`, {
      bearerToken: session.token,
    }),
  );
}
