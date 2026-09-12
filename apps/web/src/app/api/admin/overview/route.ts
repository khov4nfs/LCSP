import { NextRequest } from "next/server";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const period = request.nextUrl.searchParams.get("period");
  const query = period ? `?period=${encodeURIComponent(period)}` : "";

  return upstreamJson(
    await upstreamRequest(`/admin/overview${query}`, {
      bearerToken: session.token,
    }),
  );
}
