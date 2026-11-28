import "server-only";

import type { NextRequest } from "next/server";
import type { ZodType } from "zod";
import { validatedBillingUpstreamJson } from "./billing-upstream";
import { requireSessionToken } from "./session-token";
import { upstreamRequest } from "./upstream-request";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { problemJson } from "./problem-json";
import { isMockModeEnabled } from "./fixtures/response";

/**
 * Business purpose: Read Admin model-reconciliation data through the authenticated billing API.
 * Business rules:
 * - A session is required locally and NestJS Admin RBAC remains authoritative; responses must match the supplied schema.
 * Execution flow:
 * 1. Reject missing sessions before network access.
 * 2. Forward the bearer and one correlation ID to the billing API.
 * 3. Validate the returned success payload or forward its problem envelope.
 * Failure cases:
 * - Missing session yields 401; malformed upstream success yields 502; upstream errors retain their status.
 * Side effects:
 * - Performs one read-only upstream request; no decision, compensation or credit movement.
 */
export async function readAdminModelReconciliation<T>(
  request: NextRequest,
  upstreamPath: string,
  schema: ZodType<T>,
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  // Why: Keep one correlation ID on the browser-to-BFF-to-Nest investigation path.
  // How: Reuse a supplied ID or create a new one before requesting the protected API.
  // Invariant: This helper never grants Admin authority; the API checks role on every case read.
  const correlationId =
    request.headers.get("x-correlation-id")?.trim() || crypto.randomUUID();
  return validatedBillingUpstreamJson(
    await upstreamRequest(upstreamPath, {
      bearerToken: session.token,
      headers: { "x-correlation-id": correlationId },
    }),
    schema,
  );
}

/**
 * Business purpose: Submit one validated Admin billing decision through the authenticated BFF.
 * Business rules:
 * - NestJS remains the authorization authority; malformed payloads never reach it.
 * - Explicit mock sessions are read-only and cannot forward a financial mutation to a live API.
 * Execution flow:
 * 1. Check session. 2. Parse request. 3. Forward JSON and correlation ID. 4. Validate response.
 * Failure cases:
 * - Missing session yields 401, mock mode 403, invalid input 400; upstream problems preserve status.
 * Side effects:
 * - Sends one protected billing mutation; the BFF itself writes no ledger rows.
 */
export async function mutateAdminModelReconciliation<TInput, TOutput>(
  request: NextRequest,
  upstreamPath: string,
  inputSchema: ZodType<TInput>,
  outputSchema: ZodType<TOutput>,
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const correlationId =
    request.headers.get("x-correlation-id")?.trim() || crypto.randomUUID();
  // Why: The mock Admin form is for local inspection, not a route into a real billing API.
  // How: Reject all decision and compensation POSTs before upstreamRequest can fall through to network.
  // Invariant: Mock financial actions cannot mutate live reconciliation or wallet state.
  if (isMockModeEnabled()) {
    return problemJson(SHARED_ERROR_CODES.forbidden, {
      status: 403,
      correlationId,
    });
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success)
    return problemJson(BILLING_ERROR_CODES.validationFailed, {
      status: 400,
      correlationId,
    });
  // Why: Financial requests must keep the same validated fields and trace identity through the BFF.
  // How: Serialize only the parsed contract payload and validate the upstream result.
  // Invariant: Client-supplied authority or extra fields cannot be forwarded by this route.
  return validatedBillingUpstreamJson(
    await upstreamRequest(upstreamPath, {
      method: "POST",
      bearerToken: session.token,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(parsed.data),
    }),
    outputSchema,
  );
}
