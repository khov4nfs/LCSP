import { z } from "zod";
import { adminTrackingOperationalSchema } from "@lcsp/contracts/assessment-domain";
import { proxyTrackingJson } from "@/lib/server/tracking-proxy";
import type { NextRequest } from "next/server";

export function GET(request: NextRequest) {
  return proxyTrackingJson(
    request,
    "/admin/tracking/operational",
    z.strictObject({}),
    adminTrackingOperationalSchema,
  );
}
