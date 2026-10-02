import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const body = await request.json().catch(() => null);
  if (!isRelationBody(body)) return new Response(null, { status: 400 });
  const { id } = await params;
  return upstreamJson(
    await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}/repository-relations`,
      {
        method: "POST",
        bearerToken: session.token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  );
}

function isRelationBody(
  value: unknown,
): value is { from_snapshot_id: string; to_snapshot_id: string; type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).from_snapshot_id === "string" &&
    typeof (value as Record<string, unknown>).to_snapshot_id === "string" &&
    typeof (value as Record<string, unknown>).type === "string"
  );
}
