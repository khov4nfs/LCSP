// Enforce server-only execution boundary: prevents BFF route helpers from entering client bundles.
import "server-only";

import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  adminModelPricingOverviewQuerySchema,
  adminModelPricingOverviewResponseSchema,
} from "@lcsp/contracts/billing";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";
import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";

/**
 * Business purpose: Expose the read-only Admin Model Pricing overview via the Next.js BFF proxy.
 *
 * Business rules:
 * - Only GET requests are supported; tariff creation, draft editing, publishing, and assignment
 *   superseding must occur directly via the Admin API rather than the Phase B2 Web UI.
 * - An authenticated session cookie is required before any upstream call; the NestJS API remains
 *   authoritative for Admin RBAC verification.
 * - Blank query parameters are omitted before validation, unknown or malformed filter parameters
 *   fail closed with HTTP 400, and upstream responses must strictly match
 *   `adminModelPricingOverviewResponseSchema` (forbidding `debitMode: "ON"`).
 *
 * Execution flow:
 * 1. Extract or generate an `x-correlation-id` header for distributed traceability.
 * 2. Require a valid session bearer token via `requireSessionToken`.
 * 3. Normalize non-empty query parameters and validate against `adminModelPricingOverviewQuerySchema`.
 * 4. Forward the authenticated GET request with `x-correlation-id` to `/admin/billing/model-pricing`.
 * 5. Validate the upstream JSON payload via `validatedBillingUpstreamJson` and return the envelope.
 *
 * Failure cases:
 * - Missing session cookie returns HTTP 401 (`AUTH_SESSION_INVALID`) without calling upstream.
 * - Invalid or unknown query parameters return HTTP 400 (`BILLING_VALIDATION_FAILED`) with `correlationId`.
 * - Upstream errors propagate their RFC 7807 problem envelope; schema mismatches or `debitMode: "ON"`
 *   fail closed with HTTP 502 (`UPSTREAM_RESPONSE_INVALID`).
 *
 * Side effects:
 * - Performs one read-only HTTP GET to the upstream billing service (or mock fixture when enabled);
 *   no database writes, credit movement, or settlement side effects occur.
 */
export async function GET(request: NextRequest) {
  // Why: Propagate a single request-scoped correlation identifier from Web BFF to NestJS API.
  // How: Reuse incoming `x-correlation-id` when non-empty, otherwise generate a fresh UUID.
  // Invariants: Every validation error and upstream call carries the same correlation ID.
  const correlationId =
    request.headers.get("x-correlation-id")?.trim() || crypto.randomUUID();

  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }

  // Why: Browser query strings may serialize cleared inputs as `?provider=`, whereas
  // `adminModelPricingOverviewQuerySchema` requires non-empty strings when a key is present.
  // How: Strip empty-string values while preserving non-empty and unknown keys for strict schema rejection.
  // Invariants: Unknown keys (e.g. `?unexpected=1`) and invalid enum/datetime values still fail closed with 400.
  const rawQuery: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (value !== "") {
      rawQuery[key] = value;
    }
  }

  const parsedQuery = adminModelPricingOverviewQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, {
      status: 400,
      correlationId,
    });
  }

  const upstreamParams = new URLSearchParams(
    Object.entries(parsedQuery.data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  const upstreamPath =
    upstreamParams.size > 0
      ? `/admin/billing/model-pricing?${upstreamParams.toString()}`
      : "/admin/billing/model-pricing";

  const upstream = await upstreamRequest(upstreamPath, {
    bearerToken: session.token,
    headers: {
      "x-correlation-id": correlationId,
    },
  });

  return validatedBillingUpstreamJson(
    upstream,
    adminModelPricingOverviewResponseSchema,
  );
}
