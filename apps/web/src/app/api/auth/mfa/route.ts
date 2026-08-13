import { NextRequest } from "next/server";

import { isMockModeEnabled } from "@/lib/server/fixtures/response";
import { successJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function DELETE(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    return successJson({ correlationId: crypto.randomUUID() });
  }

  const upstream = await upstreamRequest("/auth/mfa", {
    method: "DELETE",
    bearerToken: session.token,
  });

  return upstreamJson(upstream);
}
