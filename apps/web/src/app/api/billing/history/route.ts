import { NextRequest } from "next/server";

import { buildPaginationQuery } from "@/lib/server/query-params";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const query = buildPaginationQuery(request.nextUrl, {
    defaultPage: 1,
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  return upstreamJson(
    await upstreamRequest(`/billing/history?${query.toString()}`, {
      bearerToken: session.token,
    }),
  );
}
