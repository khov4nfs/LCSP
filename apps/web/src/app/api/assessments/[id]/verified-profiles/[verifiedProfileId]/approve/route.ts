import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; verifiedProfileId: string }>;
  },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const { id, verifiedProfileId } = await params;
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}/verified-profiles/${encodeURIComponent(verifiedProfileId)}/approve`,
    {
      method: "POST",
      bearerToken: session.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );

  return upstreamJson(upstream);
}
