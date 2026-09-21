import { NextRequest } from "next/server";
import {
  BILLING_ERROR_CODES,
  billingAdminExportQuerySchema,
  billingAdminExportReportSchema,
} from "@lcsp/contracts/billing";
import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamRequest } from "@/lib/server/upstream-request";
import { validatedBillingUpstreamJson } from "@/lib/server/billing-upstream";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const params = request.nextUrl.searchParams;
  const queryResult = billingAdminExportQuerySchema.safeParse({
    period: params.get("period") ?? undefined,
    status: params.get("status") ?? undefined,
    gateway: params.get("gateway") ?? undefined,
  });
  if (!queryResult.success) {
    return problemJson(BILLING_ERROR_CODES.validationFailed, { status: 400 });
  }

  const query = new URLSearchParams({
    period: queryResult.data.period,
    status: queryResult.data.status,
    gateway: queryResult.data.gateway,
  });
  return validatedBillingUpstreamJson(
    await upstreamRequest(`/admin/billing/export?${query.toString()}`, {
      bearerToken: session.token,
    }),
    billingAdminExportReportSchema,
  );
}
