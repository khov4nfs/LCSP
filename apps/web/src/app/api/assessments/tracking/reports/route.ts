import {
  customerTrackingPortfolioQuerySchema,
  customerTrackingReportsSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyTrackingJson } from "@/lib/server/tracking-proxy";
import type { NextRequest } from "next/server";

export function GET(request: NextRequest) {
  return proxyTrackingJson(
    request,
    "/assessments/tracking/reports",
    customerTrackingPortfolioQuerySchema,
    customerTrackingReportsSchema,
  );
}
