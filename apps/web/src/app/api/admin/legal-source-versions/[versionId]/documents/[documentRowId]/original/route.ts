import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceOriginal,
} from "@/lib/server/legal-source-proxy";

type RouteContext = {
  params: Promise<{ versionId: string; documentRowId: string }>;
};

/**
 * Business purpose: Download the authorized original bytes of an Admin’s identified legal
 *   document.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the version/document UUIDs and preserve the binary response through the shared
 *   private, noncached download proxy.
 *
 * Execution flow:
 * 1. Validate both route identities.
 * 2. Forward the original-document read with session authority and preserve binary download
 *   metadata.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream binary read; no JSON success wrapping or document mutation.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { versionId, documentRowId } = await context.params;
  const version = parseLegalSourceRouteId(versionId);
  const document = parseLegalSourceRouteId(documentRowId);
  if (!version || !document) return invalidLegalSourceRouteId();
  return proxyLegalSourceOriginal(
    request,
    `/admin/legal-source-versions/${version}/documents/${document}/original`,
  );
}
