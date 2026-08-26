import { SIGN_UP_ERROR_CODES } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session/session-store";
import { isMockModeEnabled } from "@/lib/server/fixtures/response";
import { problemJson, successJson } from "@/lib/server/problem-json";
import { upstreamRequest } from "@/lib/server/upstream-request";

type SignUpApiSuccess = {
  session_token: string;
};

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);

  if (isMockModeEnabled()) {
    const response = successJson({ authenticated: true }, { status: 201 });
    response.cookies.set(
      SESSION_COOKIE_NAME,
      "mock-session:customer",
      sessionCookieOptions,
    );
    return response;
  }

  const upstream = await upstreamRequest("/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    return problemJson(safeSignUpErrorCode(upstream.result), {
      status: upstream.status,
    });
  }

  if (!isSignUpApiSuccess(upstream.data)) {
    return problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, {
      status: 502,
    });
  }

  const response = successJson({ authenticated: true }, { status: 201 });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    upstream.data.session_token,
    sessionCookieOptions,
  );
  return response;
}

function isSignUpApiSuccess(payload: unknown): payload is SignUpApiSuccess {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { session_token?: unknown }).session_token === "string"
  );
}

function safeSignUpErrorCode(payload: unknown): string {
  const code = getProblemCode(payload);
  return code === SIGN_UP_ERROR_CODES.emailAlreadyExists ||
    code === SIGN_UP_ERROR_CODES.passwordTooShort ||
    code === SIGN_UP_ERROR_CODES.invalidRequest
    ? code
    : SHARED_ERROR_CODES.upstreamResponseInvalid;
}

function getProblemCode(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const candidate = payload as {
    ok?: unknown;
    problem?: { code?: unknown };
  };
  return candidate.ok === false && typeof candidate.problem?.code === "string"
    ? candidate.problem.code
    : undefined;
}
