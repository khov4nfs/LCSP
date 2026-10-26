import type { NextRequest } from "next/server";
import { legalSourceVersionDetailSchema } from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceDelete,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ versionId: string }> };

/**
 * Business purpose: Retrieve Admin detail for one identified Legal Source Version.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - The version identity must be a UUID and success must satisfy
 *   legalSourceVersionDetailSchema.
 *
 * Execution flow:
 * 1. Validate the version route identity.
 * 2. Forward the authenticated detail read and validate its response.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream read; source/version state is unchanged.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { versionId } = await context.params;
  const id = parseLegalSourceRouteId(versionId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(request, `/admin/legal-source-versions/${id}`, {
    responseSchema: legalSourceVersionDetailSchema,
  });
}

/**
 * Business purpose: Forward guarded discard of one identified Legal Source Version.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the version UUID; the API owns draft/discard eligibility and immutable-source
 *   protection.
 *
 * Execution flow:
 * 1. Validate the version route identity.
 * 2. Forward DELETE through the shared session helper and preserve its result.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream discard request; no direct source, graph or Preparation deletion.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { versionId } = await context.params;
  const id = parseLegalSourceRouteId(versionId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceDelete(request, `/admin/legal-source-versions/${id}`);
}
