import { NextRequest } from "next/server";

import {
  isMockModeEnabled,
  readMockJson,
} from "@/lib/server/fixtures/response";
import { successJson } from "@/lib/server/problem-json";
import { sanitizeRepositoriesPayload } from "@/lib/server/repository-connections";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    return successJson(await readMockJson("repositories.json"));
  }

  const upstream = await upstreamRequest("/github/repositories", {
    bearerToken: session.token,
  });
  return validatedUpstreamJson(upstream, sanitizeRepositoriesPayload);
}
