import type { NextRequest } from "next/server";
import type { z } from "zod";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  claimAssessmentRootRequestSchema,
} from "@lcsp/contracts/assessment-domain";
import { isSupportedResponseLanguage } from "@lcsp/contracts/shared/locale";
import { APP_LOCALE_COOKIE } from "../locale";
import { requireSessionToken } from "./session-token";
import { problemJson, successJson } from "./problem-json";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { upstreamJson, upstreamRequest } from "./upstream-request";

/** Resolve authoritative persisted user/system locale from request cookie or header. */
export function getAuthoritativeRequestLocale(
  request: NextRequest,
): string | undefined {
  const cookieLocale = request.cookies.get(APP_LOCALE_COOKIE)?.value;
  const headerLocale = request.headers.get("x-lcsp-locale");
  const rawLocale = cookieLocale ?? headerLocale;
  return isSupportedResponseLanguage(rawLocale) ? rawLocale : undefined;
}

/** Shared transport/session validation for canonical assessment consumers. */
export async function proxyAssessmentJson(
  request: NextRequest,
  id: string,
  suffix = "",
  options: {
    method?: string;
    bodySchema?: z.ZodType;
    responseSchema?: z.ZodType;
  } = {},
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (
    !claimAssessmentRootRequestSchema.shape.assessmentId.safeParse(id).success
  )
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  const body = options.bodySchema?.safeParse(
    await request.json().catch(() => null),
  );
  if (body && !body.success)
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  const locale = getAuthoritativeRequestLocale(request);
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}${suffix}`,
    {
      bearerToken: session.token,
      method: options.method ?? "GET",
      locale,
      ...(body?.success
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body.data),
          }
        : {}),
    },
  );
  if (!upstream.ok || !options.responseSchema) return upstreamJson(upstream);
  const parsed = options.responseSchema.safeParse(upstream.data);
  return parsed.success
    ? successJson(parsed.data, { status: upstream.status })
    : problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, { status: 502 });
}
