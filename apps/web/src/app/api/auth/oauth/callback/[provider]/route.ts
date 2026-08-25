import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session/session-store";
import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { readSessionToken } from "@/lib/server/session-token";
import { upstreamRequest, upstreamUrl } from "@/lib/server/upstream-request";

const oauthProviders = new Set(["google"]);
const OAUTH_LINK_STATE_COOKIE_NAME = "lcsp_oauth_link_state";

type OAuthCallbackSuccess = {
  session_token: string;
  mfa_required?: boolean;
  mfa_enrolled?: boolean;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const requestUrl = new URL(request.url);
  const publicOrigin = resolvePublicOrigin(request);
  const { provider } = await context.params;

  if (!oauthProviders.has(provider)) {
    return NextResponse.redirect(
      new URL("/sign-in?oauth=failed", publicOrigin),
    );
  }

  const state = requestUrl.searchParams.get("state");
  const isLinkCallback =
    state !== null &&
    state === request.cookies.get(OAUTH_LINK_STATE_COOKIE_NAME)?.value;
  const sessionToken = readSessionToken(request);

  if (isLinkCallback) {
    return handleLinkCallback({
      requestUrl,
      publicOrigin,
      provider,
      sessionToken,
    });
  }

  const endpoint = upstreamUrl("/auth/oauth/callback");
  endpoint.searchParams.set("provider", provider);
  copySearchParam(requestUrl, endpoint, "code");
  copySearchParam(requestUrl, endpoint, "state");

  const upstream = await upstreamRequest(endpoint);

  if (!isOAuthCallbackSuccess(upstream.data)) {
    return NextResponse.redirect(
      new URL("/sign-in?oauth=failed", publicOrigin),
    );
  }

  const destination = upstream.data.mfa_required ? "/mfa/verify" : "/workspace";
  const response = NextResponse.redirect(new URL(destination, publicOrigin));
  response.cookies.set(
    SESSION_COOKIE_NAME,
    upstream.data.session_token,
    sessionCookieOptions,
  );
  return response;
}

async function handleLinkCallback(input: {
  requestUrl: URL;
  publicOrigin: string;
  provider: string;
  sessionToken: string | undefined;
}) {
  if (!input.sessionToken) {
    return linkCallbackResponse(input.publicOrigin, false);
  }

  const endpoint = upstreamUrl("/auth/oauth/link/callback");
  endpoint.searchParams.set("provider", input.provider);
  copySearchParam(input.requestUrl, endpoint, "code");
  copySearchParam(input.requestUrl, endpoint, "state");

  const upstream = await upstreamRequest(endpoint, {
    bearerToken: input.sessionToken,
  });
  return linkCallbackResponse(
    input.publicOrigin,
    isOAuthLinkCallbackSuccess(upstream.data),
  );
}

function linkCallbackResponse(publicOrigin: string, succeeded: boolean) {
  const response = NextResponse.redirect(
    new URL(
      `/workspace/settings?section=account&oauth_link=${succeeded ? "success" : "failed"}`,
      publicOrigin,
    ),
  );
  response.cookies.set(OAUTH_LINK_STATE_COOKIE_NAME, "", {
    path: "/api/auth/oauth/callback",
    maxAge: 0,
  });
  return response;
}

function copySearchParam(source: URL, destination: URL, name: string) {
  const value = source.searchParams.get(name);
  if (value) {
    destination.searchParams.set(name, value);
  }
}

function isOAuthCallbackSuccess(
  payload: unknown,
): payload is OAuthCallbackSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { session_token?: unknown }).session_token === "string"
  );
}

function isOAuthLinkCallbackSuccess(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { provider?: unknown }).provider === "string" &&
    typeof (payload as { linked?: unknown }).linked === "boolean"
  );
}
