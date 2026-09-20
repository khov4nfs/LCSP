import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id } = await context.params;

  return upstreamJson(
    await upstreamRequest(`/billing/orders/${encodeURIComponent(id)}`, {
      bearerToken: session.token,
    }),
  );
}
