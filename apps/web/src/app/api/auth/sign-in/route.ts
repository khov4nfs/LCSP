import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
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
};

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
      });
      response.cookies.set(
        SESSION_COOKIE_NAME,
        "mock-session:manager",
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
    typeof (payload as { session_token?: unknown }).session_token === "string"
  );
}
