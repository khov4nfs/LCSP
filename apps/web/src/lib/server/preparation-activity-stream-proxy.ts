// Enforce server-only execution for the ADMIN-only Preparation activity stream.
import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";

import { problemJson } from "./problem-json";
import { proxyEventStream } from "./proxy-event-stream";
import { requireSessionToken } from "./session-token";
import { upstreamUrl } from "./upstream-request";

/**
 * Business purpose:
 * Proxy one authenticated ADMIN Preparation activity stream without using the customer workspace transport.
 *
 * Business rules:
 * - A valid Preparation UUID and authenticated session are required; backend ADMIN RBAC remains authoritative.
 * - The proxy forwards only the dedicated Preparation stream path.
 * - The browser correlation identifier is preserved across the BFF boundary, or generated when absent.
 *
 * Execution flow:
 * 1. Validate the session and route UUID.
 * 2. Build the exact upstream ADMIN stream URL.
 * 3. Forward SSE bytes with bearer authentication, correlation, and cancellation propagation.
 *
 * Failure cases:
 * - Missing sessions return 401, invalid UUIDs return 422, and upstream stream failures preserve their status.
 *
 * Side effects:
 * - Opens one read-only upstream SSE connection; no Preparation state is changed.
 */
export async function proxyPreparationActivityStream(
  request: NextRequest,
  context: { params: Promise<{ preparationRunId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { preparationRunId } = await context.params;
  if (!z.uuid().safeParse(preparationRunId).success)
    return problemJson(SHARED_ERROR_CODES.validationFailed, { status: 422 });

  const target = upstreamUrl(
    `/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/activity/stream`,
  );
  // Keep one trace identifier from browser through Next and NestJS. Generating only when the
  // caller omitted it preserves caller-side diagnostics without trusting it for authorization.
  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  return proxyEventStream(
    target,
    {
      accept: "text/event-stream",
      authorization: `Bearer ${session.token}`,
      "x-correlation-id": correlationId,
    },
    request.signal,
  );
}
