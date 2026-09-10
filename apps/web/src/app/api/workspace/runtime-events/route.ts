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

  return proxyEventStream(
    upstreamUrl("/workspace/runtime-events"),
    {
      accept: "text/event-stream",
      authorization: `Bearer ${session.token}`,
    },
    request.signal,
  );
}
