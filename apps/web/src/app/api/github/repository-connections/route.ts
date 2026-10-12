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
  if (!isConnectionBody(body)) return new Response(null, { status: 400 });
  const upstream = await upstreamRequest("/github/repository-connections", {
    method: "POST",
    bearerToken: session.token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return upstreamJson(upstream);
}

function isConnectionBody(value: unknown): value is {
  credential: string;
  provider?: string;
  repository_url?: string;
  repository_full_name?: string;
  assessment_id?: string;
  credential_expires_at?: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.credential === "string" &&
    (typeof body.repository_url === "string" ||
      typeof body.repository_full_name === "string") &&
    (body.provider === undefined || typeof body.provider === "string") &&
    (body.assessment_id === undefined ||
      typeof body.assessment_id === "string") &&
    (body.credential_expires_at === undefined ||
      typeof body.credential_expires_at === "string")
  );
}
