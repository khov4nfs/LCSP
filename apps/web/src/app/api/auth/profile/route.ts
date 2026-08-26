import { NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_USER_ROLES,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";

import { getProblemRequiredAction } from "@/lib/api/problem-envelope";
import { isMockModeEnabled } from "@/lib/server/fixtures/response";
import { successJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { SESSION_COOKIE_NAME } from "@/lib/session/session-store";
import {
  upstreamJson,
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    return successJson({
      user_id: "mock-user",
      email: "minhpnq1807@gmail.com",
      email_verified: true,
      display_name: "Phan Nguyen Quoc Minh",
      recovery_email: "minhpnq1807@gmail.com",
      primary_email_address_policy:
        AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.accountEmail,
      backup_recovery_email_policy: AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail,
      created_at: new Date("2026-07-01T08:00:00.000Z").toISOString(),
      updated_at: new Date("2026-07-31T20:00:00.000Z").toISOString(),
      role: AUTH_USER_ROLES.customer,
      mfa_enrolled: true,
      mfa_enrolled_at: new Date("2026-07-31T19:10:00.000Z").toISOString(),
      mfa_verified: true,
      mfa_verified_at: new Date("2026-07-31T19:20:00.000Z").toISOString(),
      current_session_id: "mock-session-current",
      current_session_created_at: new Date(
        "2026-07-31T19:00:00.000Z",
      ).toISOString(),
      current_session_updated_at: new Date(
        "2026-07-31T20:30:00.000Z",
      ).toISOString(),
      current_session_expires_at: new Date(
        "2026-08-14T20:30:00.000Z",
      ).toISOString(),
    });
  }

  const upstream = await upstreamRequest("/auth/profile", {
    bearerToken: session.token,
  });
  if (
    upstream.problemCode === AUTH_ERROR_CODES.rbacDenied &&
    getProblemRequiredAction(upstream.result) === REQUIRED_ACTIONS.contactOwner
  ) {
    const response = upstreamJson(upstream);
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }
  return validatedUpstreamJson(upstream, sanitizeProfilePayload);
}

export async function PATCH(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    const body = (await request.json().catch(() => null)) as {
      recovery_email?: unknown;
      primary_email_address_policy?: unknown;
      backup_recovery_email_policy?: unknown;
    } | null;
    const updated_fields: string[] = [];
    if (typeof body?.recovery_email === "string") {
      updated_fields.push("recovery_email");
    }
    if (typeof body?.primary_email_address_policy === "string") {
      updated_fields.push("primary_email_address_policy");
    }
    if (typeof body?.backup_recovery_email_policy === "string") {
      updated_fields.push("backup_recovery_email_policy");
    }
    return successJson({
      updated_fields,
    });
  }

  const body = await request.text();
  const upstream = await upstreamRequest("/auth/profile", {
    method: "PATCH",
    bearerToken: session.token,
    headers: { "content-type": "application/json" },
    body,
  });

  return upstreamJson(upstream);
}

function sanitizeProfilePayload(data: unknown) {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  return typeof candidate.user_id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.email_verified === "boolean" &&
    (typeof candidate.display_name === "string" ||
      candidate.display_name === null) &&
    (typeof candidate.recovery_email === "string" ||
      candidate.recovery_email === null) &&
    typeof candidate.primary_email_address_policy === "string" &&
    typeof candidate.backup_recovery_email_policy === "string" &&
    typeof candidate.created_at === "string" &&
    typeof candidate.updated_at === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.mfa_enrolled === "boolean" &&
    (typeof candidate.mfa_enrolled_at === "string" ||
      candidate.mfa_enrolled_at === null) &&
    typeof candidate.mfa_verified === "boolean" &&
    (typeof candidate.mfa_verified_at === "string" ||
      candidate.mfa_verified_at === null) &&
    typeof candidate.current_session_id === "string" &&
    typeof candidate.current_session_created_at === "string" &&
    typeof candidate.current_session_updated_at === "string" &&
    typeof candidate.current_session_expires_at === "string"
    ? candidate
    : null;
}
