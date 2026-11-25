import { NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  capabilitySettingsSchema,
  updateCapabilitySettingsSchema,
  type CapabilitySettingsResponse,
} from "@lcsp/contracts/auth";

import {
  isMockModeEnabled,
  readMockJson,
} from "@/lib/server/fixtures/response";
import { problemJson, successJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamJson,
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

/**
 * Business purpose: Validate and normalize upstream capability settings payload against the canonical contract.
 *
 * Business rules:
 * - Requires strict conformance with capabilitySettingsSchema.
 * - Rejects malformed or unexpected data shapes by returning null.
 *
 * Execution flow:
 * 1. Parse payload with capabilitySettingsSchema.safeParse.
 * 2. Return validated data on success, otherwise null.
 *
 * Failure cases:
 * - Parsing failure returns null, prompting validatedUpstreamJson to emit an upstream validation error.
 *
 * Side effects:
 * - Pure validation function without side effects.
 */
function sanitizeCapabilitySettingsPayload(
  data: unknown,
): CapabilitySettingsResponse | null {
  const result = capabilitySettingsSchema.safeParse(data);
  return result.success ? (result.data as CapabilitySettingsResponse) : null;
}

/**
 * Business purpose: Retrieve effective capability settings and enforced platform policies for the authenticated user.
 *
 * Business rules:
 * - Requires an authenticated session token via cookie or Authorization header.
 * - In mock mode, returns local mock fixture data without remote calls.
 * - Forwards bearer credentials upstream and validates response shape.
 *
 * Execution flow:
 * 1. Extract and validate session token from the incoming request.
 * 2. Return local mock fixture if mock mode is active.
 * 3. Forward request to upstream backend /auth/capabilities endpoint.
 * 4. Return validated JSON envelope.
 *
 * Failure cases:
 * - Missing or invalid session tokens return 401 Unauthorized envelope.
 * - Upstream failures or invalid payloads return upstream unavailable or validation problem.
 *
 * Side effects:
 * - None: read-only lookup.
 */
export async function GET(request: NextRequest) {
  // Rationale (Why): Authenticated session token is mandatory to protect account capability settings.
  // Mechanism (How): Reads and validates session cookie or Authorization header.
  // Invariants (What): Unauthenticated requests are rejected immediately with 401.
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    return successJson(
      await readMockJson<CapabilitySettingsResponse>("capability-settings.json"),
    );
  }

  const upstream = await upstreamRequest("/auth/capabilities", {
    bearerToken: session.token,
  });

  return validatedUpstreamJson(upstream, sanitizeCapabilitySettingsPayload);
}

/**
 * Business purpose: Update customer-configurable capability settings for the authenticated user.
 *
 * Business rules:
 * - Requires an authenticated session token via cookie or Authorization header.
 * - Request payload must strictly conform to updateCapabilitySettingsSchema; locked platform fields are rejected.
 * - Forwards validated changes to upstream backend /auth/capabilities endpoint.
 *
 * Execution flow:
 * 1. Extract and validate session token from the incoming request.
 * 2. Parse and validate JSON request body with updateCapabilitySettingsSchema.
 * 3. In mock mode, return optimistic mock response.
 * 4. Forward payload upstream with caller's bearer token.
 * 5. Return upstream JSON envelope.
 *
 * Failure cases:
 * - Unauthenticated requests return 401 Unauthorized envelope.
 * - Schema validation errors (including attempts to modify locked platform policies) return 400 Bad Request problem envelope.
 * - Upstream errors are forwarded using standard problem envelope.
 *
 * Side effects:
 * - Mutates capability settings and records audit logging upstream.
 */
export async function PATCH(request: NextRequest) {
  // Rationale (Why): Enforces authenticated session boundary before reading mutation payload.
  // Mechanism (How): Validates session cookie or Authorization header.
  // Invariants (What): Missing session fails fast without reading body or invoking backend.
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problemJson(AUTH_ERROR_CODES.validationFailed, { status: 400 });
  }

  const parsed = updateCapabilitySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return problemJson(AUTH_ERROR_CODES.validationFailed, { status: 400 });
  }

  if (isMockModeEnabled()) {
    const mock = await readMockJson<CapabilitySettingsResponse>(
      "capability-settings.json",
    );
    return successJson({
      ...mock,
      ...parsed.data,
      updated_at: new Date().toISOString(),
    });
  }

  const upstream = await upstreamRequest("/auth/capabilities", {
    method: "PATCH",
    bearerToken: session.token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed.data),
  });

  return upstreamJson(upstream);
}
