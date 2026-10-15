import type { NextRequest } from "next/server";
import {
  createLegalSourceRequestSchema,
  legalSourceDetailSchema,
  legalSourceListSchema,
} from "@lcsp/contracts/legal-source";

import { proxyLegalSourceJson } from "@/lib/server/legal-source-proxy";

export function GET(request: NextRequest) {
  return proxyLegalSourceJson(request, "/admin/legal-sources", {
    responseSchema: legalSourceListSchema,
  });
}

export function POST(request: NextRequest) {
  return proxyLegalSourceJson(request, "/admin/legal-sources", {
    method: "POST",
    bodySchema: createLegalSourceRequestSchema,
    responseSchema: legalSourceDetailSchema,
  });
}
