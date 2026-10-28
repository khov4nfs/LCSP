import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceUpload,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ versionId: string }> };

/**
 * Business purpose: Forward an Admin’s uploaded original legal document into an identified
 *   source version.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the version UUID; the shared upload proxy validates file presence, size and
 *   legal-document metadata.
 *
 * Execution flow:
 * 1. Validate the version identity.
 * 2. Delegate multipart validation and binary forwarding to the shared upload proxy.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - Uploads original file bytes and metadata to the API; no local ingest job is fabricated.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { versionId } = await context.params;
  const id = parseLegalSourceRouteId(versionId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceUpload(
    request,
    `/admin/legal-source-versions/${id}/documents/upload`,
  );
}
