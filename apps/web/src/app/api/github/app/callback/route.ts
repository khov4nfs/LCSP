import { NextRequest, NextResponse } from "next/server";

import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { upstreamRequest, upstreamUrl } from "@/lib/server/upstream-request";

type GitHubAppCallbackSuccess = {
  connection_id: string;
};

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const publicOrigin = resolvePublicOrigin(request);
  const endpoint = upstreamUrl("/github/app/callback");
  copySearchParam(requestUrl, endpoint, "installation_id");
  copySearchParam(requestUrl, endpoint, "code");
  copySearchParam(requestUrl, endpoint, "state");
  copySearchParam(requestUrl, endpoint, "repository_id");

  const upstream = await upstreamRequest(endpoint);

  return redirectToRepositories(
    publicOrigin,
    isGitHubAppCallbackSuccess(upstream.data) ? "success" : "failed",
  );
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

function isGitHubAppCallbackSuccess(
  payload: unknown,
): payload is GitHubAppCallbackSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { connection_id?: unknown }).connection_id === "string"
  );
}
