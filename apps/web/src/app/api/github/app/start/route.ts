import { NextRequest, NextResponse } from "next/server";

import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest, upstreamUrl } from "@/lib/server/upstream-request";

type GitHubAppStartSuccess = {
  installation_url: string;
};

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const requestUrl = new URL(request.url);
  const publicOrigin = resolvePublicOrigin(request);
  const redirectUri = new URL("/api/github/app/callback", publicOrigin);
  const endpoint = upstreamUrl("/github/app/start");
  endpoint.searchParams.set("redirect_uri", redirectUri.toString());
  copySearchParam(requestUrl, endpoint, "assessment_id");
  copySearchParam(requestUrl, endpoint, "installation_id");

  const upstream = await upstreamRequest(endpoint, {
    bearerToken: session.token,
  });

  if (!isGitHubAppStartSuccess(upstream.data)) {
    return redirectToRepositories(publicOrigin, "failed");
  }

  return NextResponse.redirect(upstream.data.installation_url);
}

function copySearchParam(source: URL, destination: URL, name: string) {
  const value = source.searchParams.get(name);
  if (value) {
    destination.searchParams.set(name, value);
  }
}

function redirectToRepositories(publicOrigin: string, result: string) {
  return NextResponse.redirect(
    new URL(
      `/workspace/settings?section=connectors&github_connection=${result}`,
      publicOrigin,
    ),
  );
}

function isGitHubAppStartSuccess(
  payload: unknown,
): payload is GitHubAppStartSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { installation_url?: unknown }).installation_url ===
      "string"
  );
}
