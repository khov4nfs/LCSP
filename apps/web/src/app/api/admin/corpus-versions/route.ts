import { NextRequest } from "next/server";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  return upstreamJson(
    await upstreamRequest("/admin/corpus-versions", {
      bearerToken: session.token,
    }),
  );
}
