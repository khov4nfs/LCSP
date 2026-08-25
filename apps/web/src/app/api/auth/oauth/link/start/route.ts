import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { NextRequest, NextResponse } from "next/server";

import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest, upstreamUrl } from "@/lib/server/upstream-request";

const oauthProviders = new Set(["google"]);
const OAUTH_LINK_STATE_COOKIE_NAME = "lcsp_oauth_link_state";

type OAuthLinkStartSuccess = {
  authorization_url: string;
};

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const requestUrl = new URL(request.url);
  const publicOrigin = resolvePublicOrigin(request);
  const provider = requestUrl.searchParams.get("provider");

  if (!provider || !oauthProviders.has(provider)) {
    return problemJson(AUTH_ERROR_CODES.unsupportedProvider, { status: 400 });
  }

  const redirectUri = new URL(
    `/api/auth/oauth/callback/${provider}`,
    publicOrigin,
  );
  const endpoint = upstreamUrl("/auth/oauth/link/start");
  endpoint.searchParams.set("provider", provider);
  endpoint.searchParams.set("redirect_uri", redirectUri.toString());

  const upstream = await upstreamRequest(endpoint, {
    bearerToken: session.token,
  });

  if (!isOAuthLinkStartSuccess(upstream.data)) {
    return NextResponse.redirect(
      new URL(
        "/workspace/settings?section=account&oauth_link=failed",
        publicOrigin,
      ),
    );
  }

  const state = getAuthorizationState(upstream.data.authorization_url);
  if (!state) {
    return NextResponse.redirect(
      new URL(
        "/workspace/settings?section=account&oauth_link=failed",
        publicOrigin,
      ),
    );
  }

  const response = NextResponse.redirect(upstream.data.authorization_url);
  response.cookies.set(OAUTH_LINK_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/oauth/callback",
    maxAge: 10 * 60,
  });
  return response;
}

function isOAuthLinkStartSuccess(
  payload: unknown,
): payload is OAuthLinkStartSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { authorization_url?: unknown }).authorization_url ===
      "string"
  );
}

function getAuthorizationState(authorizationUrl: string): string | null {
  try {
    return new URL(authorizationUrl).searchParams.get("state");
  } catch {
    return null;
  }
}
