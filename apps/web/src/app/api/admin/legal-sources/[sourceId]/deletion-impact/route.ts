import type { NextRequest } from "next/server";
import { legalSourceDeletionImpactResponseSchema } from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ sourceId: string }> };

/**
 * Business purpose: Proxy the server-authorized deletion-impact preview for one Legal Source to the Admin client.
 *
 * Business rules:
 * - The preflight is informational only; the API rechecks eligibility inside the eventual delete transaction.
 * - Route identity and session handling follow the shared Legal Source proxy policy.
 *
 * Execution flow:
 * 1. Resolve and validate the dynamic source ID.
 * 2. Forward the request through the shared JSON proxy with the deletion-impact response schema.
 *
 * Failure cases:
 * - Invalid IDs use the shared route problem; authentication, upstream, and contract failures use the shared proxy response.
 *
 * Side effects:
 * - Performs one upstream read; does not change source data or lifecycle.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { sourceId } = await context.params;
  const id = parseLegalSourceRouteId(sourceId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(
    request,
    `/admin/legal-sources/${id}/deletion-impact`,
    { responseSchema: legalSourceDeletionImpactResponseSchema },
  );
}
