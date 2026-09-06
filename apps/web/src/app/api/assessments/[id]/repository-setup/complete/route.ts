import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const { id } = await params;
  return upstreamJson(
    await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}/repository-setup/complete`,
      {
        method: "POST",
        bearerToken: session.token,
      },
    ),
  );
}
