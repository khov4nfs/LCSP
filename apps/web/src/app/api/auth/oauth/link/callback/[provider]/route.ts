import { NextRequest, NextResponse } from "next/server";

import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest, upstreamUrl } from "@/lib/server/upstream-request";

const oauthProviders = new Set(["google"]);

type OAuthLinkCallbackSuccess = {
  provider: string;
  linked: boolean;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const requestUrl = new URL(request.url);
  const publicOrigin = resolvePublicOrigin(request);
  const { provider } = await context.params;

  if (!oauthProviders.has(provider)) {
    return redirectToSettings(publicOrigin, "failed");
  }

  const endpoint = upstreamUrl("/auth/oauth/link/callback");
  endpoint.searchParams.set("provider", provider);
  copySearchParam(requestUrl, endpoint, "code");
  copySearchParam(requestUrl, endpoint, "state");

  const upstream = await upstreamRequest(endpoint, {
    bearerToken: session.token,
  });

  return redirectToSettings(
    publicOrigin,
    isOAuthLinkCallbackSuccess(upstream.data) ? "success" : "failed",
  );
}

function copySearchParam(source: URL, destination: URL, name: string) {
  const value = source.searchParams.get(name);
  if (value) {
    destination.searchParams.set(name, value);
  }
}

function redirectToSettings(publicOrigin: string, result: string) {
  return NextResponse.redirect(
    new URL(
      `/workspace/settings?section=account&oauth_link=${result}`,
      publicOrigin,
    ),
  );
}

function isOAuthLinkCallbackSuccess(
  payload: unknown,
): payload is OAuthLinkCallbackSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { provider?: unknown }).provider === "string" &&
    typeof (payload as { linked?: unknown }).linked === "boolean"
  );
}
