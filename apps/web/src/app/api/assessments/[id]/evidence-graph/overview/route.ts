import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamJson,
  upstreamRequest,
  upstreamUrl,
} from "@/lib/server/upstream-request";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id } = await params;
  const target = upstreamUrl(
    `/assessments/${encodeURIComponent(id)}/evidence-graph/overview`,
  );
  const snapshotId = request.nextUrl.searchParams.get("snapshotId");
  const scanJobId = request.nextUrl.searchParams.get("scanJobId");
  if (snapshotId) target.searchParams.set("snapshotId", snapshotId);
  if (scanJobId) target.searchParams.set("scanJobId", scanJobId);

  const upstream = await upstreamRequest(target, { bearerToken: session.token });
  return upstreamJson(upstream);
}
