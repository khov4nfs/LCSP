import { NextRequest } from "next/server";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const session = requireSessionToken(_request);
  if (!session.ok) return session.response;
  const { versionId } = await params;
  return upstreamJson(
    await upstreamRequest(
      `/admin/corpus-versions/${encodeURIComponent(versionId)}`,
      { bearerToken: session.token },
    ),
  );
}
