import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id, connectionId } = await params;
  return upstreamJson(
    await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}/repositories/${encodeURIComponent(connectionId)}`,
      { method: "DELETE", bearerToken: session.token },
    ),
  );
}
