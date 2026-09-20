import { NextRequest } from "next/server";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";

import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isTopUpBody(body)) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return problemJson(BILLING_ERROR_CODES.idempotencyKeyRequired, {
      status: 400,
    });
  }

  return upstreamJson(
    await upstreamRequest("/billing/orders", {
      method: "POST",
      bearerToken: session.token,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    }),
  );
}

function isTopUpBody(value: unknown): value is { amount_vnd: string } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.amount_vnd === "string" && /^\d+$/.test(body.amount_vnd);
}
