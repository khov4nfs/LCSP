import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  preparationSourceContentRequestSchema,
  preparationSourceContentResponseSchema,
  preparationSourceNodeIdSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
import { problemJson } from "@/lib/server/problem-json";

/**
 * Business purpose: Proxy one bounded page of pinned legal-source text to an authenticated Admin browser session.
 *
 * Business rules:
 * - The session, Preparation UUID, source-node identity, inventory revision, page bounds, and opaque pinned continuation are validated.
 * - Backend Admin authorization and the persisted frontier remain authoritative for source version and materialization identity.
 *
 * Execution flow:
 * 1. Require the shared session token and validate the path and strict query contract.
 * 2. Forward only normalized paging identity through the shared upstream helper.
 * 3. Validate the response envelope data against the bounded source-content contract.
 *
 * Failure cases:
 * - Invalid session or request is rejected; upstream typed errors are preserved and malformed success data is not returned.
 *
 * Side effects:
 * - One authenticated read-only request; no Worker credential, raw HTML rendering, or source mutation is exposed.
 */
export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ preparationRunId: string; sourceNodeId: string }>;
  },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { preparationRunId, sourceNodeId } = await context.params;
  const query = preparationSourceContentRequestSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (
    !z.uuid().safeParse(preparationRunId).success ||
    !preparationSourceNodeIdSchema.safeParse(sourceNodeId).success ||
    !query.success
  ) {
    return problemJson(SHARED_ERROR_CODES.validationFailed, { status: 422 });
  }

  const params = new URLSearchParams({
    inventoryRevision: String(query.data.inventoryRevision),
    limit: String(query.data.limit),
  });
  if (query.data.cursor) {
    params.set("cursor", query.data.cursor);
  }
  const path = `/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/source-units/${encodeURIComponent(sourceNodeId)}/content?${params}`;
  return validatedUpstreamJson(
    await upstreamRequest(path, { bearerToken: session.token }),
    (data) => {
      const parsed = preparationSourceContentResponseSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
