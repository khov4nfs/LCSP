import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamUrl } from "@/lib/server/upstream-request";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }

  const response = await fetch(upstreamUrl("/workspace/runtime-events"), {
    cache: "no-store",
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${session.token}`,
    },
  }).catch(() => null);

  if (response === null || response.body === null) {
    return new Response(null, { status: 503 });
  }

  if (!response.ok) {
    return new Response(null, { status: response.status });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type":
        response.headers.get("content-type") ?? "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
}
