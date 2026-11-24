import { NextRequest, NextResponse } from "next/server";
import { OAUTH_LINK_QUERY_RESULTS } from "@lcsp/contracts/auth";

import { resolvePublicOrigin } from "@/lib/http/request-origin";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest, upstreamUrl } from "@/lib/server/upstream-request";

const oauthProviders = new Set(["google"]);

type OAuthLinkCallbackSuccess = {
  provider: string;
  linked: boolean;
};

/**
 * Business purpose: Handle direct OAuth link callback route and redirect back to Account Settings with normalized outcome.
 *
 * Business rules:
 * - Requires an active session token.
 * - Validates provider against supported OAuth providers allowlist.
 * - Checks for provider cancellation error parameters before contacting upstream.
 * - Upstream success distinguishes new link (success) vs already linked (already_linked).
 *
 * Execution flow:
 * 1. Validate session token and provider parameter.
 * 2. Handle provider errors or missing code/state parameters.
 * 3. Forward code and state to upstream /auth/oauth/link/callback with bearer authorization.
 * 4. Redirect user to /workspace/settings?section=account&oauth_link=<result>.
 *
 * Failure cases:
 * - Unauthenticated requests redirect with session_expired.
 * - Unsupported providers redirect with failed.
 * - Upstream failures or 401s redirect with failed or session_expired.
 *
 * Side effects:
 * - Redirects browser to Account Settings with outcome query parameter.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const publicOrigin = resolvePublicOrigin(request);
  const session = requireSessionToken(request);
  if (!session.ok) {
    return redirectToSettings(
      publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.sessionExpired,
    );
  }

  const requestUrl = new URL(request.url);
  const { provider } = await context.params;

  if (!oauthProviders.has(provider)) {
    return redirectToSettings(publicOrigin, OAUTH_LINK_QUERY_RESULTS.failed);
  }

  const errorParam = requestUrl.searchParams.get("error");
  if (errorParam) {
    return redirectToSettings(
      publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.cancelled,
    );
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state) {
    return redirectToSettings(publicOrigin, OAUTH_LINK_QUERY_RESULTS.failed);
  }

  const endpoint = upstreamUrl("/auth/oauth/link/callback");
  endpoint.searchParams.set("provider", provider);
  endpoint.searchParams.set("code", code);
  endpoint.searchParams.set("state", state);

  const upstream = await upstreamRequest(endpoint, {
    bearerToken: session.token,
  });

  if (upstream.status === 401) {
    return redirectToSettings(
      publicOrigin,
      OAUTH_LINK_QUERY_RESULTS.sessionExpired,
    );
  }

  if (!upstream.ok || !isOAuthLinkCallbackSuccess(upstream.data)) {
    return redirectToSettings(publicOrigin, OAUTH_LINK_QUERY_RESULTS.failed);
  }

  return redirectToSettings(
    publicOrigin,
    upstream.data.linked
      ? OAUTH_LINK_QUERY_RESULTS.success
      : OAUTH_LINK_QUERY_RESULTS.alreadyLinked,
  );
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
