import type { NextRequest } from "next/server";
import { activeLegalLibrarySchema } from "@lcsp/contracts/legal-source";

import { proxyLegalSourceJson } from "@/lib/server/legal-source-proxy";

export function GET(request: NextRequest) {
  return proxyLegalSourceJson(request, "/legal-library", {
    responseSchema: activeLegalLibrarySchema,
  });
}
