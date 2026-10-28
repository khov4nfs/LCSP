import type { NextRequest } from "next/server";
import {
  createLegalSourceRequestSchema,
  legalSourceDetailSchema,
  legalSourceListSchema,
} from "@lcsp/contracts/legal-source";

import { proxyLegalSourceJson } from "@/lib/server/legal-source-proxy";

/**
 * Business purpose: List the Admin-visible legal-source catalog using the shared
 *   authenticated result contract.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Accept success only when it satisfies legalSourceListSchema.
 *
 * Execution flow:
 * 1. Forward the catalog read through the session proxy.
 * 2. Validate and return the source list.
 *
 * Failure cases:
 * - Session/API problems and malformed list responses follow the shared proxy’s existing
 *   problem policy.
 *
 * Side effects:
 * - One read-only upstream catalog request.
 */
export function GET(request: NextRequest) {
  return proxyLegalSourceJson(request, "/admin/legal-sources", {
    responseSchema: legalSourceListSchema,
  });
}

/**
 * Business purpose: Create an Admin-managed legal-source definition through its canonical
 *   API.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate createLegalSourceRequestSchema and the returned legalSourceDetailSchema.
 *
 * Execution flow:
 * 1. Validate the source-creation body in the shared helper.
 * 2. Forward POST creation and validate the source detail.
 *
 * Failure cases:
 * - Invalid JSON/schema data yields the shared request problem; session and API failures are
 *   forwarded.
 *
 * Side effects:
 * - One upstream source-creation mutation.
 */
export function POST(request: NextRequest) {
  return proxyLegalSourceJson(request, "/admin/legal-sources", {
    method: "POST",
    bodySchema: createLegalSourceRequestSchema,
    responseSchema: legalSourceDetailSchema,
  });
}
