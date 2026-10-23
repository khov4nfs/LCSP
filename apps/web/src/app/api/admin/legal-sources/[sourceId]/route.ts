import type { NextRequest } from "next/server";
import {
  legalSourceDetailSchema,
  updateLegalSourceRequestSchema,
} from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ sourceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { sourceId } = await context.params;
  const id = parseLegalSourceRouteId(sourceId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(request, `/admin/legal-sources/${id}`, {
    responseSchema: legalSourceDetailSchema,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { sourceId } = await context.params;
  const id = parseLegalSourceRouteId(sourceId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(request, `/admin/legal-sources/${id}`, {
    method: "PATCH",
    bodySchema: updateLegalSourceRequestSchema,
    responseSchema: legalSourceDetailSchema,
  });
}
