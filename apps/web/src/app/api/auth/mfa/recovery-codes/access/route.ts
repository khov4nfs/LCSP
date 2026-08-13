import { NextRequest } from "next/server";

import { isMockModeEnabled } from "@/lib/server/fixtures/response";
import { successJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const body: unknown = await request.json().catch(() => null);
  const action =
    typeof body === "object" && body !== null
      ? (body as { action?: unknown }).action
      : undefined;

  if (isMockModeEnabled()) {
    return successJson({ correlationId: crypto.randomUUID() });
  }

  const upstream = await upstreamRequest("/auth/mfa/recovery-codes/access", {
    method: "POST",
    bearerToken: session.token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });

  return upstreamJson(upstream);
}
