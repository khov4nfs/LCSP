import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  billingCreateOrderSchema,
  billingIdempotencyKeySchema,
  billingOrderViewSchema,
} from "@lcsp/contracts/billing";

import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";

export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 415 });
  }

  const bodyResult = billingCreateOrderSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!bodyResult.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  }
  const idempotencyKeyResult = billingIdempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!idempotencyKeyResult.success) {
    return problemJson(BILLING_ERROR_CODES.idempotencyKeyRequired, {
      status: 400,
    });
  }

  return validatedBillingUpstreamJson(
    await upstreamRequest("/billing/orders", {
      method: "POST",
      bearerToken: session.token,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKeyResult.data,
      },
      body: JSON.stringify(bodyResult.data),
    }),
    billingOrderViewSchema,
  );
}
