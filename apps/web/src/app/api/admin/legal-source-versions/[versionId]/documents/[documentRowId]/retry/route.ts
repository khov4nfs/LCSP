import type { NextRequest } from "next/server";
import { legalSourceDocumentViewSchema } from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = {
  params: Promise<{ versionId: string; documentRowId: string }>;
};

/**
 * Business purpose: Request retry of ingestion for an Admin’s identified version/document
 *   pair.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate both UUIDs; the API decides whether ingestion can be retried.
 *
 * Execution flow:
 * 1. Validate the version and document identities.
 * 2. Forward POST retry and validate the returned document view.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream retry request; the BFF does not reset ingestion or launch its own worker.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { versionId, documentRowId } = await context.params;
  const version = parseLegalSourceRouteId(versionId);
  const document = parseLegalSourceRouteId(documentRowId);
  if (!version || !document) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(
    request,
    `/admin/legal-source-versions/${version}/documents/${document}/retry`,
    { method: "POST", responseSchema: legalSourceDocumentViewSchema },
  );
}
