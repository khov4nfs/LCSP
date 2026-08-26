import { NextRequest } from "next/server";

import { successJson } from "@/lib/server/problem-json";
import { readSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { SESSION_COOKIE_NAME } from "@/lib/session/session-store";

export async function POST(request: NextRequest) {
  const sessionToken = readSessionToken(request);

  if (sessionToken) {
    await upstreamRequest("/auth/revoke-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_token: sessionToken }),
    }).catch(() => null);
  }

  const response = successJson(null);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
