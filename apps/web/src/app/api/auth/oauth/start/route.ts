import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { NextResponse } from "next/server";

import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { problemJson } from "@/lib/server/problem-json";
import { upstreamRequest, upstreamUrl } from "@/lib/server/upstream-request";

const oauthProviders = new Set(["google"]);

type OAuthStartSuccess = {
  authorization_url: string;
};

export async function GET(request: Request) {
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
  const endpoint = upstreamUrl("/auth/oauth/start");
  endpoint.searchParams.set("provider", provider);
  endpoint.searchParams.set("redirect_uri", redirectUri.toString());

  const upstream = await upstreamRequest(endpoint);

  if (!isOAuthStartSuccess(upstream.data)) {
    return NextResponse.redirect(
      new URL("/sign-in?oauth=failed", publicOrigin),
    );
  }

  return NextResponse.redirect(upstream.data.authorization_url);
}

function isOAuthStartSuccess(payload: unknown): payload is OAuthStartSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { authorization_url?: unknown }).authorization_url ===
      "string"
  );
}
