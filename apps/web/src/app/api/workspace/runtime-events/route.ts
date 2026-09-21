import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamUrl } from "@/lib/server/upstream-request";
import { proxyEventStream } from "@/lib/server/proxy-event-stream";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }

  const target = upstreamUrl("/workspace/runtime-events");
  const assessmentId = request.nextUrl.searchParams.get("assessment_id");
  if (assessmentId) {
    target.searchParams.set("assessment_id", assessmentId);
  }
  if (request.nextUrl.searchParams.get("agent_stream_only") === "1") {
    target.searchParams.set("agent_stream_only", "1");
  }

  return proxyEventStream(
    target,
    {
      accept: "text/event-stream",
      authorization: `Bearer ${session.token}`,
    },
    request.signal,
  );
}
