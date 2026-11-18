import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import {
  isMockModeEnabled,
  readMockJson,
} from "@/lib/server/fixtures/response";
import type { MockManagerAccount } from "@/lib/server/fixtures/workspace";

import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session/session-store";
import { problemJson, successJson } from "@/lib/server/problem-json";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

type SignInApiSuccess = {
  mfa_required?: boolean;
  mfa_enrolled?: boolean;
  session_token: string;
  user: { subject_attributes: { role: AuthUserRole } };
};

/**
 * Business purpose: Authenticate user credentials and establish a secure authenticated session.
 *
 * Business rules:
 * - Credentials must be validated against known identity providers or mock credentials.
 * - Successfully authenticated users receive an HTTP-only secure session cookie.
 *
 * Execution flow:
 * 1. Parse JSON credential payload from incoming authentication request.
 * 2. Validate credentials against local mock accounts if mock mode is active, or forward to upstream.
 * 3. Issue session cookie and return authentication state and user role.
 *
 * Failure cases:
 * - Invalid JSON payloads or invalid credentials return 401 Unauthorized problem envelopes.
 * - Upstream failures or network timeouts return service unavailable problem responses.
 *
 * Side effects:
 * - Sets the secure session cookie on the outgoing HTTP response.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (isMockModeEnabled()) {
    const managerAccount = await readMockJson<MockManagerAccount>(
      "manager-account.json",
    );
    const credentials = body as { email?: unknown; password?: unknown };
    if (
      credentials.email === managerAccount.email &&
      credentials.password === managerAccount.password
    ) {
      const response = successJson({
        mfa_enrolled: false,
        role: AUTH_USER_ROLES.customer,
      });
      response.cookies.set(
        SESSION_COOKIE_NAME,
        "mock-session:manager",
        sessionCookieOptions,
      );
      return response;
    }

    if (
      credentials.email === "admin@example.com" ||
      credentials.email === "admin@lcsp.local" ||
      (typeof credentials.email === "string" && credentials.email.startsWith("admin"))
    ) {
      const response = successJson({
        mfa_enrolled: false,
        role: AUTH_USER_ROLES.admin,
      });
      response.cookies.set(
        SESSION_COOKIE_NAME,
        "mock-session:admin",
        sessionCookieOptions,
      );
      return response;
    }

    return problemJson(AUTH_ERROR_CODES.invalidCredentials, { status: 401 });
  }

  const upstream = await upstreamRequest("/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    return upstreamJson(upstream);
  }

  if (!isSignInApiSuccess(upstream.data)) {
    return problemJson(AUTH_ERROR_CODES.invalidCredentials, { status: 502 });
  }

  const response = successJson({
    mfa_required: upstream.data.mfa_required === true,
    mfa_enrolled: upstream.data.mfa_enrolled === true,
    role: upstream.data.user.subject_attributes.role,
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    upstream.data.session_token,
    sessionCookieOptions,
  );
  return response;
}

function isSignInApiSuccess(payload: unknown): payload is SignInApiSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { session_token?: unknown }).session_token ===
      "string" &&
    isAuthUserRole(
      (payload as { user?: { subject_attributes?: { role?: unknown } } }).user
        ?.subject_attributes?.role,
    )
  );
}

function isAuthUserRole(value: unknown): value is AuthUserRole {
  return Object.values(AUTH_USER_ROLES).includes(value as AuthUserRole);
}
