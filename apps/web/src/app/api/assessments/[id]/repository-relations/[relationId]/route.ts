import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; relationId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const body = await request.json().catch(() => null);
  if (!isRelationBody(body)) return new Response(null, { status: 400 });
  const { id, relationId } = await params;
  return upstreamJson(
    await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}/repository-relations/${encodeURIComponent(relationId)}`,
      {
        method: "PATCH",
        bearerToken: session.token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; relationId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id, relationId } = await params;
  return upstreamJson(
    await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}/repository-relations/${encodeURIComponent(relationId)}`,
      { method: "DELETE", bearerToken: session.token },
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
