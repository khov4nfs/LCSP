import { NextRequest } from "next/server";
import {
  linkedIdentitiesResponseSchema,
  type LinkedIdentitiesResponse,
} from "@lcsp/contracts/auth";

import {
  isMockModeEnabled,
  readMockJson,
} from "@/lib/server/fixtures/response";
import { successJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

/**
 * Business purpose: Retrieve the authenticated user's linked third-party OAuth identities.
 *
 * Business rules:
 * - Requires a valid session token from either cookie or authorization header.
 * - In mock mode, returns local mock identities without remote network requests.
 * - Only returns safe, public identity summaries (id, provider, linked_at).
 *
 * Execution flow:
 * 1. Extract and validate session token from the incoming request.
 * 2. Return mock identities representation if mock mode is active.
 * 3. Forward request to upstream authentication service and validate returned identities.
 *
 * Failure cases:
 * - Missing or invalid session tokens return 401 Unauthorized problem envelopes.
 * - Upstream failures or invalid payloads return upstream unavailable or validation problems.
 *
 * Side effects:
 * - None: read-only identities lookup.
 */
export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    return successJson(
      await readMockJson<LinkedIdentitiesResponse>("oauth-identities.json"),
    );
  }

  const upstream = await upstreamRequest("/auth/oauth/identities", {
    bearerToken: session.token,
  });

  return validatedUpstreamJson(upstream, sanitizeLinkedIdentitiesPayload);
}

/**
 * Business purpose: Sanitize and validate upstream linked OAuth identities payload against the domain contract.
 *
 * Business rules:
 * - Requires strict conformance with linkedIdentitiesResponseSchema.
 * - Rejects malformed or unexpected data shapes by returning null.
 *
 * Execution flow:
 * 1. Execute safe parse against linkedIdentitiesResponseSchema.
 * 2. Return validated data on success or null on failure.
 *
 * Failure cases:
 * - Returns null when schema validation fails.
 *
 * Side effects:
 * - None: pure validation function.
 */
function sanitizeLinkedIdentitiesPayload(
  data: unknown,
): LinkedIdentitiesResponse | null {
  const parsed = linkedIdentitiesResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
