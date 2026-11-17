import { SESSION_COOKIE_NAME } from "@/lib/session/session-store";
import { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

/**
 * Business purpose: Load the authenticated owner's active session metadata.
 * Business rules:
 * - Require a session token and accept only the backend's safe session projection.
 * Execution flow:
 * 1. Forward the authenticated read and validate the result using the shared envelope helper.
 * Failure cases:
 * - Missing authentication and upstream failures return problems rather than an empty list.
 * Side effects:
 * - Read-only upstream request; no mock sessions or credentials are fabricated.
 */
export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const upstream = await upstreamRequest("/auth/sessions", {
    bearerToken: session.token,
  });
  return validatedUpstreamJson(upstream, sanitizeSessionsPayload);
}

function sanitizeSessionsPayload(data: unknown) {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const sessions = (data as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return null;
  }

  return sessions.every((session) => {
    if (typeof session !== "object" || session === null) {
      return false;
    }

    const candidate = session as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.created_at === "string" &&
      typeof candidate.updated_at === "string" &&
      typeof candidate.expires_at === "string" &&
      (typeof candidate.revoked_at === "string" ||
        candidate.revoked_at === null) &&
      (typeof candidate.mfa_verified_at === "string" ||
        candidate.mfa_verified_at === null) &&
      typeof candidate.is_current === "boolean"
    );
  })
    ? { sessions }
    : null;
}

/**
 * Business purpose: Forward owner-scoped all-device logout and clear browser authentication on confirmed success.
 * Business rules:
 * - Never clear cookies or acknowledge logout when the backend rejects or cannot confirm revocation.
 * Execution flow:
 * 1. Require the caller session and forward the DELETE to the shared upstream helper.
 * 2. Validate completion and expire the local session cookie only on success.
 * Failure cases:
 * - Upstream failures preserve cookies and the canonical problem envelope.
 * Side effects:
 * - Backend revokes all sessions; confirmed success removes the local authentication cookie.
 */
export async function DELETE(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const upstream = await upstreamRequest("/auth/sessions", {
    method: "DELETE",
    bearerToken: session.token,
  });
  const response = validatedUpstreamJson(upstream, sanitizeAllRevokedPayload);
  if (response.ok) response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

/**
 * Business purpose: Accept only an explicit backend acknowledgment of all-session revocation.
 * Business rules:
 * - A missing or false acknowledgment cannot clear browser authentication.
 * Execution flow:
 * 1. Check the completion flag and return the minimal safe projection.
 * Failure cases:
 * - Malformed success payloads return null for a 502 response.
 * Side effects:
 * - Pure payload validation.
 */
function sanitizeAllRevokedPayload(data: unknown) {
  return typeof data === "object" &&
    data !== null &&
    (data as { revoked_all?: unknown }).revoked_all === true
    ? { revoked_all: true }
    : null;
}
