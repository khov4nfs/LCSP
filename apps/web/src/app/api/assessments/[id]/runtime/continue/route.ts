import { proxyAssessmentRuntimeControl } from "@/lib/server/assessment-runtime-control-proxy";
import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentRuntimeControl(request, (await params).id, "continue");
}
