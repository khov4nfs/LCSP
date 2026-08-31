import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return new Response(null, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isRepositoryBody(body)) return new Response(null, { status: 400 });
  const { id } = await params;
  return upstreamJson(
    await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}/repository-connection`,
      {
        method: "POST",
        bearerToken: session.token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  );
}

function isRepositoryBody(value: unknown): value is { repositoryUrl: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { repositoryUrl?: unknown }).repositoryUrl === "string"
  );
}
