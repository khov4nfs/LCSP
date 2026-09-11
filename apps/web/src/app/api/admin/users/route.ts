import { proxyAdminAccountInvite } from "@/lib/server/admin-account-mutations";
import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }

  const url = new URL(request.url);
  const upstream = await upstreamRequest(
    `/admin/users?${url.searchParams.toString()}`,
    {
      bearerToken: session.token,
    },
  );

  return upstreamJson(upstream);
}

export async function POST(request: import("next/server").NextRequest) {
  return proxyAdminAccountInvite(request);
}
