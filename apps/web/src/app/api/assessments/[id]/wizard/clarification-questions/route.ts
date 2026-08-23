import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}/wizard/clarification-questions`,
    {
      method: "POST",
      bearerToken: session.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  return upstreamJson(upstream);
}
