// Enforce server-only execution: prevent session token extraction helper from leaking into client bundles
import "server-only";

import type { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import { SESSION_COOKIE_NAME } from "@/lib/session/session-store";
import { problemJson } from "@/lib/server/problem-json";

export type SessionTokenResult =
  | { ok: true; token: string }
  | { ok: false; response: ReturnType<typeof problemJson> };

export function requireSessionToken(request: NextRequest): SessionTokenResult {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token
    ? { ok: true, token }
    : {
        ok: false,
        response: problemJson(AUTH_ERROR_CODES.sessionInvalid, {
          status: 401,
        }),
      };
}

export function readSessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value;
}
