import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { isMockModeEnabled } from "@/lib/server/fixtures/response";
import { successJson } from "@/lib/server/problem-json";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(request: Request) {
  if (isMockModeEnabled()) {
    return successJson({ requested: true, mock_recovery_token: "mock-recovery-token" });
  }
  const body = await request.text();
  const origin = resolvePublicOrigin(request);
  const upstream = await upstreamRequest("/auth/recovery/request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-app-origin": origin,
    },
    body,
  });

  return upstreamJson(upstream);
}
