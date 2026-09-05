import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  REQUIRED_ACTIONS,
  type RequiredAction,
} from "@lcsp/contracts/auth";

import { SESSION_COOKIE_NAME } from "./lib/session/session-store";
import { upstreamRequest } from "./lib/server/upstream-request.ts";
import { getProblemRequiredAction } from "./lib/api/problem-envelope.ts";
import { getWorkspaceRouteRedirectPath } from "./workspace-route-middleware.ts";
import {
  getMarketingLocale,
  localizedMarketingPath,
  MARKETING_LOCALE_COOKIE,
} from "./features/marketing/config/marketing-routing";

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
  if (localeMatch) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-lcsp-locale", localeMatch[1]);
    return continueProxy(request, requestHeaders);
  }

  return continueProxy(request, request.headers);
}

async function continueProxy(request: NextRequest, requestHeaders: Headers) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const redirectPath = getWorkspaceRouteRedirectPath({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSession: Boolean(sessionToken),
  });

  if (redirectPath) {
    return NextResponse.redirect(new URL(redirectPath, request.url));
  }

  if (!sessionToken) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

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
    const expiredSessionRedirectPath = getWorkspaceRouteRedirectPath({
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      hasSession: false,
    });
    const response = NextResponse.redirect(
      new URL(expiredSessionRedirectPath ?? "/sign-in", request.url),
    );
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
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
    problemCode === AUTH_ERROR_CODES.sessionInvalid
  );
}

export const config = {
  matcher: [
    "/",
    "/features",
    "/pricing",
    "/en/:path*",
    "/vi/:path*",
    "/workspace/:path*",
    "/assessments/:path*",
    "/laws/:path*",
  ],
};
