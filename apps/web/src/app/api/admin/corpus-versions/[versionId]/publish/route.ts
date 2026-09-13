import { NextRequest } from "next/server";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { versionId } = await params;
  const body = await request.json().catch(() => ({}));
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  return upstreamJson(await upstreamRequest(
    `/admin/corpus-versions/${encodeURIComponent(versionId)}/publish`,
    {
      method: "POST",
      bearerToken: session.token,
      body: JSON.stringify({ idempotencyKey }),
      headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
    },
  ));
}
