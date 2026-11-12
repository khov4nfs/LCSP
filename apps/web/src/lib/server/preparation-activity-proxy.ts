import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  preparationActivityPageSchema,
  preparationActivityQuerySchema,
} from "@lcsp/contracts/evidence";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { requireSessionToken } from "./session-token";
import { upstreamRequest, validatedUpstreamJson } from "./upstream-request";
import { problemJson } from "./problem-json";
/**
 * Business purpose: Forward authorized Preparation journal paging without duplicating persistence or build authority.
 * Business rules:
 * - Validate run UUID, bounded cursor query and public envelope; API Admin authorization remains mandatory.
 * Execution flow:
 * 1. Require a session and forward the exact run/cursor through shared upstream transport.
 * Failure cases:
 * - Missing session, invalid input and upstream problems remain explicit failures.
 * Side effects:
 * - One read-only upstream call; no model or build execution.
 */
export async function proxyPreparationActivity(
  request: NextRequest,
  context: { params: Promise<{ preparationRunId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { preparationRunId } = await context.params;
  const query = preparationActivityQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!z.uuid().safeParse(preparationRunId).success || !query.success)
    return problemJson(SHARED_ERROR_CODES.validationFailed, { status: 422 });
  const params = new URLSearchParams({ limit: String(query.data.limit) });
  if (query.data.cursor) params.set("cursor", query.data.cursor);
  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/activity?${params}`,
      { bearerToken: session.token },
    ),
    (data) => {
      const result = preparationActivityPageSchema.safeParse(data);
      return result.success ? result.data : null;
    },
  );
}
