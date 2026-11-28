import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  REQUIRED_ACTIONS,
  type RequiredAction,
} from "@lcsp/contracts/auth";

import { SESSION_COOKIE_NAME } from "./lib/session/session-store";
import {
  upstreamJson,
  upstreamRequest,
} from "./lib/server/upstream-request.ts";
import { getProblemRequiredAction } from "./lib/api/problem-envelope.ts";
import { getWorkspaceRouteRedirectPath } from "./workspace-route-middleware.ts";
import { getAdminRouteRedirectPath } from "./admin-route-middleware.ts";
import {
  getMarketingLocale,
  localizedMarketingPath,
  MARKETING_LOCALE_COOKIE,
} from "./features/marketing/config/marketing-routing";
import { APP_LOCALE_COOKIE } from "./lib/locale";

const AUTH_LOCALE_ROUTE_PATHS = [
  "/sign-in",
  "/sign-up",
  "/mfa/verify",
  "/mfa/enroll",
  "/recovery/request",
  "/recovery/confirm",
] as const;

/**
 * Business purpose: Forward the selected UI locale so server-rendered auth screens agree with the persisted browser choice.
 * Business rules:
 * - Supported locale path prefixes take precedence; otherwise the auth locale cookie selects Vietnamese and all other values fall back to English.
 * - Public auth pages must bypass workspace/admin session gates and profile verification exactly as they did before locale forwarding.
 * Execution flow:
 * 1. Resolve the locale from a supported path prefix or the locale cookie and attach it to request headers.
 * 2. Pass public auth page requests through with that header without invoking session checks or upstream profile requests.
 * 3. Continue all other matched routes through the existing workspace and admin guards.
 * Failure cases:
 * - Missing or unsupported locale cookies use English; existing protected-route redirects and session failures keep their current outcomes.
 * Side effects:
 * - Adds an internal request header only; it does not change auth cookies, sessions, authorization or backend state.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicPath =
    pathname === "/" || pathname === "/features" || pathname === "/pricing";
  if (publicPath) {
    const locale = getMarketingLocale(
      request.cookies.get(MARKETING_LOCALE_COOKIE)?.value,
    );
    return NextResponse.redirect(
      new URL(localizedMarketingPath(locale, pathname), request.url),
    );
  }

  const localeMatch = pathname.match(/^\/(en|vi)(?=\/|$)/);
  const requestHeaders = new Headers(request.headers);
  if (localeMatch) {
    requestHeaders.set("x-lcsp-locale", localeMatch[1]);
  } else {
    const cookieLocale = request.cookies.get(APP_LOCALE_COOKIE)?.value;
    const resolvedLocale = cookieLocale === "vi" ? "vi" : "en";
    requestHeaders.set("x-lcsp-locale", resolvedLocale);
  }

  // Auth paths use Proxy only for locale forwarding; keep them outside the existing workspace/admin guard flow.
  if (AUTH_LOCALE_ROUTE_PATHS.includes(pathname as (typeof AUTH_LOCALE_ROUTE_PATHS)[number])) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return continueProxy(request, requestHeaders);
}

/**
 * Business purpose:
 * Apply authenticated server-side route gates before rendering protected customer or ADMIN pages.
 *
 * Business rules:
 * - Expired sessions are cleared, ADMIN pages require ADMIN, and customer workspace pages reject ADMIN.
 * - Backend authorization remains authoritative; this early redirect only prevents loading the wrong UI contract.
 *
 * Execution flow:
 * 1. Apply unauthenticated path gates and verify any presented session upstream.
 * 2. Clear invalid sessions and redirect to sign-in when required.
 * 3. Apply ADMIN-portal and customer-workspace role routing from the verified profile.
 *
 * Failure cases:
 * - Missing or invalid sessions redirect safely; profile failures stop rendering and unknown roles invalidate the session.
 *
 * Side effects:
 * - May call the auth profile API, issue a redirect and delete an invalid session cookie.
 */
async function continueProxy(request: NextRequest, requestHeaders: Headers) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;

  // 1. Unauthenticated route gates (workspace & admin)
  const adminUnauthRedirect = getAdminRouteRedirectPath({
    pathname,
    search,
    hasSession: Boolean(sessionToken),
  });
  if (adminUnauthRedirect) {
    return NextResponse.redirect(new URL(adminUnauthRedirect, request.url));
  }

  const workspaceRedirectPath = getWorkspaceRouteRedirectPath({
    pathname,
    search,
    hasSession: Boolean(sessionToken),
  });
  if (workspaceRedirectPath) {
    return NextResponse.redirect(new URL(workspaceRedirectPath, request.url));
  }

  if (!sessionToken) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // 2. Verify active session against upstream auth profile
  const verification = await upstreamRequest("/auth/profile", {
    bearerToken: sessionToken,
  });
  if (
    isExpiredSessionVerification(
      verification.status,
      verification.problemCode,
      getProblemRequiredAction(verification.result),
    )
  ) {
    const expiredSessionRedirectPath =
      getAdminRouteRedirectPath({ pathname, search, hasSession: false }) ??
      getWorkspaceRouteRedirectPath({ pathname, search, hasSession: false });
    const response = NextResponse.redirect(
      new URL(expiredSessionRedirectPath ?? "/sign-in", request.url),
    );
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  // A protected page must never render from an unverified profile. Preserve the upstream
  // problem/status so transient auth-service failures do not masquerade as an authorized role.
  if (!verification.ok) {
    return upstreamJson(verification);
  }

  // 3. Admin Portal RBAC gate & landing evaluation
  const rawUserRole = (verification.data as { role?: string })?.role;
  if (
    rawUserRole !== AUTH_USER_ROLES.admin &&
    rawUserRole !== AUTH_USER_ROLES.customer
  ) {
    // Unknown roles are contract violations, not implicit CUSTOMER access. Clear the session
    // to avoid a redirect loop that repeatedly reloads an unusable protected UI contract.
    const response = NextResponse.redirect(new URL("/sign-in", request.url));
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }
  const userRole = rawUserRole;

  const adminAuthRedirect = getAdminRouteRedirectPath({
    pathname,
    search,
    hasSession: true,
    userRole,
  });
  if (adminAuthRedirect) {
    return NextResponse.redirect(new URL(adminAuthRedirect, request.url));
  }

  // After profile verification, keep ADMIN out of customer-only clients whose
  // contracts intentionally require the full owned assessment projection.
  const workspaceAuthRedirect = getWorkspaceRouteRedirectPath({
    pathname,
    search,
    hasSession: true,
    userRole,
  });
  if (workspaceAuthRedirect) {
    return NextResponse.redirect(new URL(workspaceAuthRedirect, request.url));
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

function isExpiredSessionVerification(
  status: number,
  problemCode: string | undefined,
  requiredAction: RequiredAction | undefined,
): boolean {
  return (
    status === 401 ||
    requiredAction === REQUIRED_ACTIONS.signIn ||
    (problemCode === AUTH_ERROR_CODES.rbacDenied &&
      requiredAction === REQUIRED_ACTIONS.contactOwner) ||
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid ||
    problemCode === AUTH_ERROR_CODES.accountSuspended
  );
}

export const config = {
  matcher: [
    "/",
    "/features",
    "/pricing",
    // Next statically analyzes matcher entries, so keep public auth paths literal instead of spreading the runtime route list.
    "/sign-in",
    "/sign-up",
    "/mfa/verify",
    "/mfa/enroll",
    "/recovery/request",
    "/recovery/confirm",
    "/en/:path*",
    "/vi/:path*",
    "/preview-compliance",
    "/workspace/:path*",
    "/assessments/:path*",
    "/laws/:path*",
    "/admin",
    "/admin/:path*",
  ],
};

