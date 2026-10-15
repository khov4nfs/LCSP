import type { NextRequest } from "next/server";
import {
  createLegalSourceVersionRequestSchema,
  legalSourceVersionDetailSchema,
} from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ sourceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { sourceId } = await context.params;
  const id = parseLegalSourceRouteId(sourceId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(request, `/admin/legal-sources/${id}/versions`, {
    method: "POST",
    bodySchema: createLegalSourceVersionRequestSchema,
    responseSchema: legalSourceVersionDetailSchema,
  });
}
