import type { NextRequest } from "next/server";
import type { z } from "zod";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { getAuthoritativeRequestLocale } from "./assessment-domain-proxy";
import { requireSessionToken } from "./session-token";
import { problemJson, successJson } from "./problem-json";
import { upstreamJson, upstreamRequest } from "./upstream-request";

export async function proxyTrackingJson<TQuery, TResponse>(
  request: NextRequest,
  upstreamPath: string,
  querySchema: z.ZodType<TQuery>,
  responseSchema: z.ZodType<TResponse>,
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const rawQuery = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = querySchema.safeParse(rawQuery);
  if (!query.success) {
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, { status: 422 });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query.data ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  const upstream = await upstreamRequest(`${upstreamPath}${suffix}`, {
    bearerToken: session.token,
    locale: getAuthoritativeRequestLocale(request),
  });
  if (!upstream.ok) return upstreamJson(upstream);
  const parsed = responseSchema.safeParse(upstream.data);
  return parsed.success
    ? successJson(parsed.data, { status: upstream.status })
    : problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, { status: 502 });
}
