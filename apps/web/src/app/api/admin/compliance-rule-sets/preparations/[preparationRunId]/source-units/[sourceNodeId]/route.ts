import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  preparationSourceNodeIdSchema,
  preparationSourceUnitDetailRequestSchema,
  preparationSourceUnitDetailResponseSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
import { problemJson } from "@/lib/server/problem-json";

/**
 * Business purpose: Proxy one pinned Source Review detail to the authenticated Admin API.
 *
 * Business rules:
 * - A valid session, Preparation UUID, bounded source-node identity, and inventory revision are required.
 * - The Admin backend retains role authorization and is the authority for run, frontier, version, and materialization pins.
 *
 * Execution flow:
 * 1. Validate session, path values, and the strict detail query contract.
 * 2. Forward only the validated revision using the shared session bearer request helper.
 * 3. Validate the response DTO before returning the upstream envelope.
 *
 * Failure cases:
 * - Missing session, malformed input, upstream authorization problems, and invalid response bodies use existing shared BFF handling.
 *
 * Side effects:
 * - One authenticated read-only API request; no Worker credential or execution capability is exposed.
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
  const query = preparationSourceUnitDetailRequestSchema.safeParse(
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
  });
  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/source-units/${encodeURIComponent(sourceNodeId)}?${params}`,
      { bearerToken: session.token },
    ),
    (data) => {
      const parsed = preparationSourceUnitDetailResponseSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
