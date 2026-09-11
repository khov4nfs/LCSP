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
  return upstreamJson(
    await upstreamRequest(
      `/admin/corpus-versions/${encodeURIComponent(versionId)}/discard`,
      { method: "POST", bearerToken: session.token },
    ),
  );
}
