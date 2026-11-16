import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  preparationGeneratedCatalogRequestSchema,
  preparationGeneratedCatalogResponseSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

/**
 * Business purpose: Proxy one bounded generated-catalog page to the authenticated Admin API.
 *
 * Business rules:
 * - A valid session, Preparation UUID, and strict shared catalog query are required; backend Admin RBAC and persistence remain authoritative.
 * - Only validated query fields are forwarded, and successful upstream data must satisfy the shared catalog response schema.
 *
 * Execution flow:
 * 1. Validate session, route identity, and query parameters.
 * 2. Forward the normalized query through the shared bearer-token upstream helper.
 * 3. Validate and return the upstream envelope data with the shared BFF response helper.
 *
 * Failure cases:
 * - Missing session, malformed input, upstream authorization errors, and invalid response data preserve established shared error handling.
 *
 * Side effects:
 * - One authenticated read-only request; no Worker credential or Rule Set mutation authority is exposed.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ preparationRunId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { preparationRunId } = await context.params;
  const query = preparationGeneratedCatalogRequestSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!z.uuid().safeParse(preparationRunId).success || !query.success) {
    return problemJson(SHARED_ERROR_CODES.validationFailed, { status: 422 });
  }
  const params = new URLSearchParams({
    inventoryRevision: String(query.data.inventoryRevision),
    kind: query.data.kind,
    limit: String(query.data.limit),
  });
  if (query.data.cursor) params.set("cursor", query.data.cursor);
  if (query.data.search) params.set("search", query.data.search);
  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/catalog?${params}`,
      { bearerToken: session.token },
    ),
    (data) => {
      const parsed = preparationGeneratedCatalogResponseSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
