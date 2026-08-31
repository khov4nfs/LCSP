import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  return upstreamJson(
    await upstreamRequest("/provider-credentials", {
      bearerToken: session.token,
    }),
  );
}

export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return new Response(null, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isCredentialBody(body)) return new Response(null, { status: 400 });
  return upstreamJson(
    await upstreamRequest("/provider-credentials", {
      method: "POST",
      bearerToken: session.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function isCredentialBody(value: unknown): value is {
  provider: string;
  credential: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.provider === "string" && typeof body.credential === "string";
}
