import { NextRequest, NextResponse } from "next/server";
import { OAUTH_LINK_QUERY_RESULTS } from "@lcsp/contracts/auth";

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

type OAuthLinkCallbackSuccess = {
  provider: string;
  linked: boolean;
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

/**
 * Business purpose: Forward OAuth linking callback parameters to the upstream API and normalize the redirect outcome.
 *
 * Business rules:
 * - Requires active session token; missing token redirects with session_expired.
 * - Error parameters from OAuth provider redirect with cancelled.
 * - Missing code or state parameters redirect with failed.
 * - Distinguishes newly linked (success) from already linked (already_linked) accounts.
 *
 * Execution flow:
 * 1. Validate session token and incoming error/code/state query parameters.
 * 2. Send guarded callback request to upstream API with bearer authorization.
 * 3. Classify response status and payload into normalized outcome and redirect to settings.
 *
 * Failure cases:
 * - Session expired redirects with session_expired.
 * - Provider errors redirect with cancelled.
 * - Upstream failures or schema mismatches redirect with failed.
 *
 * Side effects:
 * - Clears linking state cookie and redirects browser.
 */
async function handleLinkCallback(input: {
  requestUrl: URL;
  publicOrigin: string;
  provider: string;
  sessionToken: string | undefined;
}) {
  if (!input.sessionToken) {
    return linkCallbackResponse(
      input.publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.sessionExpired,
    );
  }

  const errorParam = input.requestUrl.searchParams.get("error");
  if (errorParam) {
    return linkCallbackResponse(
      input.publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.cancelled,
    );
  }

  const code = input.requestUrl.searchParams.get("code");
  const state = input.requestUrl.searchParams.get("state");
  if (!code || !state) {
    return linkCallbackResponse(
      input.publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.failed,
    );
  }

  const endpoint = upstreamUrl("/auth/oauth/link/callback");
  endpoint.searchParams.set("provider", input.provider);
  endpoint.searchParams.set("code", code);
  endpoint.searchParams.set("state", state);

  const upstream = await upstreamRequest(endpoint, {
    bearerToken: input.sessionToken,
  });

  if (upstream.status === 401) {
    return linkCallbackResponse(
      input.publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.sessionExpired,
    );
  }

  if (!upstream.ok || !isOAuthLinkCallbackSuccess(upstream.data)) {
    return linkCallbackResponse(
      input.publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.failed,
    );
  }

  return linkCallbackResponse(
    input.publicOrigin,
    upstream.data.linked
      ? OAUTH_LINK_QUERY_RESULTS.success
      : OAUTH_LINK_QUERY_RESULTS.alreadyLinked,
  );
}

/**
 * Business purpose: Build a redirect response targeting the account settings panel with normalized linking result.
 *
 * Business rules:
 * - Appends oauth_link outcome query parameter to settings destination URL.
 * - Always clears the temporary OAuth linking state cookie.
 *
 * Execution flow:
 * 1. Construct target URL with account section and outcome result.
 * 2. Attach expired cookie header to delete linking state.
 * 3. Return HTTP 307 redirect response.
 *
 * Failure cases:
 * - Invalid origin or URL parsing errors propagate.
 *
 * Side effects:
 * - Clears lcsp_oauth_link_state cookie.
 */
function linkCallbackResponse(publicOrigin: string, result: string) {
  const response = NextResponse.redirect(
    new URL(
      `/workspace/settings?section=account&oauth_link=${result}`,
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

/**
 * Business purpose: Type guard verifying that the upstream link callback payload matches the expected schema.
 *
 * Business rules:
 * - Requires an object with a string provider and boolean linked property.
 *
 * Execution flow:
 * 1. Check that payload is non-null object.
 * 2. Validate types of provider and linked properties.
 *
 * Failure cases:
 * - Returns false for non-matching payloads.
 *
 * Side effects:
 * - None: pure type guard.
 */
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
