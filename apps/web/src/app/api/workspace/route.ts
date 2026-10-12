import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import {
  isMockModeEnabled,
  readMockJson,
} from "@/lib/server/fixtures/response";
import { problemJson, successJson } from "@/lib/server/problem-json";
import {
  readSessionToken,
  requireSessionToken,
} from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  if (isMockModeEnabled()) {
    const sessionToken = readSessionToken(request);
    if (sessionToken === "mock-session:mfa-verify-pending") {
      return problemJson(AUTH_ERROR_CODES.mfaRequired, {
        status: 403,
      });
    }
    if (sessionToken === "mock-session:manager") {
      return successJson(await readMockJson("workspace.json"));
    }

    return problemJson(AUTH_ERROR_CODES.authRequired, { status: 401 });
  }

  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const upstream = await upstreamRequest("/auth/profile", {
    bearerToken: session.token,
  });

  if (upstream.ok && upstream.data && typeof upstream.data === "object") {
    const profile = upstream.data as {
      user_id?: string;
      email?: string;
      display_name?: string | null;
      role?: string;
      [key: string]: unknown;
    };
    const adaptedData = {
      ...profile,
      display_name: profile.display_name ?? profile.email ?? "",
    };
    return successJson(adaptedData, { status: upstream.status });
  }

  return upstreamJson(upstream);
}
