import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return new Response(null, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isDiscoveryBody(body)) return new Response(null, { status: 400 });
  const upstream = await upstreamRequest("/github/repository-discoveries", {
    method: "POST",
    bearerToken: session.token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return upstreamJson(upstream);
}

function isDiscoveryBody(
  value: unknown,
): value is { credential: string; limit?: number; cursor?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { credential?: unknown }).credential === "string" &&
    ((value as { limit?: unknown }).limit === undefined ||
      typeof (value as { limit?: unknown }).limit === "number") &&
    ((value as { cursor?: unknown }).cursor === undefined ||
      typeof (value as { cursor?: unknown }).cursor === "string")
  );
}
