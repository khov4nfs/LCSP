import { NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  privacySettingsSchema,
  updatePrivacySettingsSchema,
  type PrivacySettingsResponse,
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
 * Business purpose: Sanitize and validate upstream privacy settings payload against the contract schema.
 *
 * Business rules:
 * - Requires strict conformance with privacySettingsSchema.
 * - Rejects malformed or unexpected data shapes by returning null.
 *
 * Execution flow:
 * 1. Validate payload using privacySettingsSchema.safeParse.
 * 2. Return valid data if parse succeeds, otherwise null.
 *
 * Failure cases:
 * - Parsing failure returns null, prompting validatedUpstreamJson to emit an upstream validation error.
 *
 * Side effects:
 * - Pure validation function without side effects.
 */
function sanitizePrivacySettingsPayload(
  data: unknown,
): PrivacySettingsResponse | null {
  const result = privacySettingsSchema.safeParse(data);
  return result.success ? (result.data as PrivacySettingsResponse) : null;
}

/**
 * Business purpose: Retrieve authenticated user privacy settings and policy enforcements.
 *
 * Business rules:
 * - Requires an authenticated session token via cookie or Authorization header.
 * - In mock mode, returns local mock fixture data without remote calls.
 * - Forwards bearer credentials upstream and validates response shape.
 *
 * Execution flow:
 * 1. Extract and validate session token from the incoming request.
 * 2. Return local mock fixture if mock mode is active.
 * 3. Forward request to upstream backend /auth/privacy endpoint.
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
  // Rationale (Why): Authenticated session token is mandatory to protect user privacy configuration.
  // Mechanism (How): Reads and validates session cookie or Authorization header.
  // Invariants (What): Unauthenticated requests are rejected immediately with 401.
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    return successJson(
      await readMockJson<PrivacySettingsResponse>("privacy-settings.json"),
    );
  }

  const upstream = await upstreamRequest("/auth/privacy", {
    bearerToken: session.token,
  });

  return validatedUpstreamJson(upstream, sanitizePrivacySettingsPayload);
}

/**
 * Business purpose: Update authenticated user privacy settings and model training controls.
 *
 * Business rules:
 * - Requires an authenticated session token via cookie or Authorization header.
 * - Request payload must conform to updatePrivacySettingsSchema.
 * - Forwards validated changes to upstream backend /auth/privacy endpoint.
 *
 * Execution flow:
 * 1. Extract and validate session token from the incoming request.
 * 2. Parse and validate JSON request body with updatePrivacySettingsSchema.
 * 3. In mock mode, return optimistic mock response.
 * 4. Forward payload upstream with caller's bearer token.
 * 5. Return upstream JSON envelope.
 *
 * Failure cases:
 * - Unauthenticated requests return 401 Unauthorized envelope.
 * - Schema validation errors return 400 Bad Request problem envelope.
 * - Upstream errors are forwarded using standard problem envelope.
 *
 * Side effects:
 * - Mutates privacy settings and records audit logging upstream.
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

  const parsed = updatePrivacySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return problemJson(AUTH_ERROR_CODES.validationFailed, { status: 400 });
  }

  if (isMockModeEnabled()) {
    const mock = await readMockJson<PrivacySettingsResponse>(
      "privacy-settings.json",
    );
    return successJson({
      ...mock,
      ...parsed.data,
      updated_at: new Date().toISOString(),
    });
  }

  const upstream = await upstreamRequest("/auth/privacy", {
    method: "PATCH",
    bearerToken: session.token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed.data),
  });

  return upstreamJson(upstream);
}
