import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }

  const { id } = await params;
  const upstream = await upstreamRequest(`/admin/users/${id}`, {
    bearerToken: session.token,
  });

  return upstreamJson(upstream);
}
