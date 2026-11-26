import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_USER_ROLES,
  OAUTH_LINK_QUERY_RESULTS,
  type AuthUserRole,
} from "@lcsp/contracts/auth";

import { postAuthRedirectPath } from "@/features/auth/utils/post-auth-redirect";
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
  expires_at: number;
  mfa_required: boolean;
  mfa_enrolled: boolean;
};

type OAuthLinkCallbackSuccess = {
  provider: string;
  linked: boolean;
};

/**
 * Business purpose: Complete the trusted provider callback and route the account through its required MFA or authorized role destination.
 *
 * Business rules:
 * - Provider, OAuth state, nonce and identity are validated by the upstream callback contract before a session is accepted.
 * - A required but unenrolled MFA factor routes to enrollment; a required enrolled factor routes to verification.
 * - A role destination is resolved only when no MFA challenge is pending, using the authenticated profile contract rather than callback/query data.
 *
 * Execution flow:
 * 1. Validate the allowlisted provider and preserve the existing account-link callback branch.
 * 2. Forward login callback code/state upstream and require a successful session plus both authoritative MFA flags.
 * 3. Route pending MFA without reading the authenticated profile, or read the guarded profile with the new session token and map its canonical role.
 * 4. Redirect to the selected internal route and set the existing session cookie with unchanged security options.
 *
 * Failure cases:
 * - Invalid provider, OAuth callback response, or unavailable/invalid role profile redirects to the existing generic OAuth failure route without setting a browser session cookie.
 * - A pending MFA challenge is never converted into an authenticated role destination.
 *
 * Side effects:
 * - The upstream callback may create a session; a valid routed result sets the existing session cookie. If role resolution fails, no browser cookie is issued and any unclaimed upstream session expires under its existing policy.
 */
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

  // The callback response is the only trusted MFA source; reject partial success before issuing a browser session.
  if (!upstream.ok || !isOAuthCallbackSuccess(upstream.data)) {
    return NextResponse.redirect(
      new URL("/sign-in?oauth=failed", publicOrigin),
    );
  }

  let destination: string;
  if (upstream.data.mfa_required) {
    destination = upstream.data.mfa_enrolled
      ? "/mfa/verify"
      : "/mfa/enroll";
  } else {
    // The OAuth callback contract omits role; only the guarded profile tied to its issued bearer token can resolve the role landing.
    const profile = await upstreamRequest("/auth/profile", {
      bearerToken: upstream.data.session_token,
    });
    if (!profile.ok || !isOAuthProfileRole(profile.data)) {
      return NextResponse.redirect(
        new URL("/sign-in?oauth=failed", publicOrigin),
      );
    }
    destination = postAuthRedirectPath(profile.data.role);
  }

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

/**
 * Business purpose: Accept only a complete upstream OAuth callback result that can safely establish the browser session.
 *
 * Business rules:
 * - The upstream callback must provide a string session token, numeric expiry, and explicit MFA-required and MFA-enrolled decisions.
 * - Missing or mistyped authorization state must never be interpreted as an MFA-free authenticated result.
 *
 * Execution flow:
 * 1. Reject null and non-object payloads.
 * 2. Inspect the callback fields without changing or deriving their values.
 * 3. Return true only when every required field has its contract type.
 *
 * Failure cases:
 * - Incomplete or malformed payloads return false so the callback route redirects to the generic failure route without issuing a browser cookie.
 *
 * Side effects:
 * - Pure validation; no session, cookie, persistence, or network effects.
 */
function isOAuthCallbackSuccess(
  payload: unknown,
): payload is OAuthCallbackSuccess {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.session_token === "string" &&
    typeof candidate.expires_at === "number" &&
    typeof candidate.mfa_required === "boolean" &&
    typeof candidate.mfa_enrolled === "boolean"
  );
}

/**
 * Business purpose: Restrict post-OAuth destination selection to roles recognized by the shared authentication contract.
 *
 * Business rules:
 * - The role must be an exact member of the canonical authentication role set.
 * - Client query parameters and untrusted callback values cannot choose a destination.
 *
 * Execution flow:
 * 1. Reject null and non-object profile payloads.
 * 2. Read the profile role and compare it with the shared role constants.
 * 3. Allow the callback to route only when that canonical role is present.
 *
 * Failure cases:
 * - Missing, malformed, or unknown roles return false and the callback fails closed without setting the session cookie.
 *
 * Side effects:
 * - Pure validation; no session, cookie, persistence, or network effects.
 */
function isOAuthProfileRole(
  payload: unknown,
): payload is { role: AuthUserRole } {
  if (typeof payload !== "object" || payload === null) return false;
  return Object.values(AUTH_USER_ROLES).includes(
    (payload as { role?: unknown }).role as AuthUserRole,
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
