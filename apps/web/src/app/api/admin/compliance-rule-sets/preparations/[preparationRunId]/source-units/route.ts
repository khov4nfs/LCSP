import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  preparationSourceUnitsRequestSchema,
  preparationSourceUnitsResponseSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
import { problemJson } from "@/lib/server/problem-json";

/**
 * Business purpose: Expose the authenticated Admin source-review page through the web BFF.
 *
 * Business rules:
 * - Require the existing session token, a valid Preparation run UUID, and the published bounded source-unit query contract.
 * - The upstream Admin API remains authoritative for role authorization and persisted run/frontier scope.
 *
 * Execution flow:
 * 1. Validate session, route identity, and normalized query parameters.
 * 2. Forward only the validated query to the canonical Admin endpoint using the session bearer token.
 * 3. Validate the success payload against the published source-units response contract.
 *
 * Failure cases:
 * - Missing session returns the existing authentication problem; invalid input returns validation failure; invalid upstream data returns upstream-response-invalid.
 *
 * Side effects:
 * - One read-only authenticated upstream request; no Worker API key or execution authority is exposed.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ preparationRunId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { preparationRunId } = await context.params;
  const parsed = preparationSourceUnitsRequestSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!z.uuid().safeParse(preparationRunId).success || !parsed.success) {
    return problemJson(SHARED_ERROR_CODES.validationFailed, { status: 422 });
  }

  const params = new URLSearchParams({
    inventoryRevision: String(parsed.data.inventoryRevision),
    limit: String(parsed.data.limit),
  });
  for (const key of ["cursor", "state", "documentId", "search"] as const) {
    const value = parsed.data[key];
    if (value) params.set(key, value);
  }

  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/source-units?${params}`,
      { bearerToken: session.token },
    ),
    (data) => {
      const result = preparationSourceUnitsResponseSchema.safeParse(data);
      return result.success ? result.data : null;
    },
  );
}
