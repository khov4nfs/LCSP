import { NextResponse } from "next/server";
import {
  AUTH_ERROR_CODES,
  createSuccessResult,
  type AppResult,
} from "@lcsp/contracts/auth";

import { getProblemCode, problemEnvelope } from "@/lib/api/problem-envelope";
import { SESSION_COOKIE_NAME } from "@/lib/session/session-store";

type WebAppResult = AppResult<unknown, string>;

export function problemJson(
  code: string,
  init: { status: number; correlationId?: string },
) {
  const response = NextResponse.json(
    problemEnvelope(code, init.status, init.correlationId),
    {
      status: init.status,
    },
  );
  clearSessionCookieOnAuthFailure(response, code);
  return response;
}

export function successJson<TData>(
  data: TData,
  init: { status?: number } = {},
) {
  return NextResponse.json(createSuccessResult(data), {
    status: init.status ?? 200,
  });
}

export function resultJson(result: WebAppResult | null, init: { status: number }) {
  const response = NextResponse.json(result, { status: init.status });
  clearSessionCookieOnAuthFailure(response, getProblemCode(result));
  return response;
}

export function readResultData(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const result = payload as Partial<AppResult>;
  return result.ok === true ? result.data : payload;
}

function clearSessionCookieOnAuthFailure(
  response: NextResponse,
  problemCode?: string,
) {
  if (
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid ||
    problemCode === AUTH_ERROR_CODES.accountSuspended
  ) {
    response.cookies.delete(SESSION_COOKIE_NAME);
  }
}
