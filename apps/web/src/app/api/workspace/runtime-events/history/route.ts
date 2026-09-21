import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamJson,
  upstreamRequest,
  upstreamUrl,
} from "@/lib/server/upstream-request";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }

  const target = upstreamUrl("/workspace/runtime-events/agent-stream-history");
  const assessmentId = request.nextUrl.searchParams.get("assessment_id");
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = request.nextUrl.searchParams.get("limit");
  if (assessmentId) {
    target.searchParams.set("assessment_id", assessmentId);
  }
  if (cursor) {
    target.searchParams.set("cursor", cursor);
  }
  if (limit) {
    target.searchParams.set("limit", limit);
  }

  return upstreamJson(
    await upstreamRequest(target, {
      bearerToken: session.token,
    }),
  );
}
