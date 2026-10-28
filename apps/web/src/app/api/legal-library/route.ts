import type { NextRequest } from "next/server";
import { activeLegalLibrarySchema } from "@lcsp/contracts/legal-source";

import { proxyLegalSourceJson } from "@/lib/server/legal-source-proxy";

/**
 * Business purpose: Return the authenticated active legal library selected by the backend.
 *
 * Business rules:
 * - Require the shared session guard and activeLegalLibrarySchema validation.
 * - This read does not activate a source or choose a replacement Rule Set.
 *
 * Execution flow:
 * 1. Forward the active-library read.
 * 2. Validate and return its canonical result.
 *
 * Failure cases:
 * - Session/API failures and malformed active-library responses follow the shared proxy
 *   policy.
 *
 * Side effects:
 * - One read-only upstream library request.
 */
export function GET(request: NextRequest) {
  return proxyLegalSourceJson(request, "/legal-library", {
    responseSchema: activeLegalLibrarySchema,
  });
}
