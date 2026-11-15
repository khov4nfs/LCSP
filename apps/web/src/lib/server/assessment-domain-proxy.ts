import type { NextRequest } from "next/server";
import type { z } from "zod";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  AUTHORED_LOCALIZATION_CODES,
  AUTHORED_LOCALIZATION_STATES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
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

/**
 * Business purpose: Read owner-authorized assessment data even while a presentation translation is pending.
 * Business rules:
 * - Only opted-in GET projections may retry without locale, and only for a pending field-level localization conflict.
 * - The fallback is explicitly marked; catalog fallback remains pending for selection eligibility.
 * Execution flow:
 * 1. Validate session, assessment ID and any command body, then request the selected locale.
 * 2. For eligible pending localization conflicts, read the canonical projection and mark it before response validation.
 * Failure cases:
 * - Authentication, validation, failed translation, conflicts without a field path and upstream errors remain explicit failures.
 * Side effects:
 * - Makes one or two authenticated upstream requests; no content or translation records are modified.
 */
export async function proxyAssessmentJson(
  request: NextRequest,
  id: string,
  suffix = "",
  options: {
    method?: string;
    bodySchema?: z.ZodType;
    responseSchema?: z.ZodType;
    allowPendingLocalizationFallback?: boolean;
    preservePendingCatalogReadiness?: boolean;
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
  let upstream = await upstreamRequest(
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
  let usedFallback = false;
  const problem =
    upstream.result && !upstream.result.ok
      ? upstream.result.problem
      : undefined;
  if (
    options.allowPendingLocalizationFallback &&
    (options.method ?? "GET") === "GET" &&
    locale &&
    upstream.status === 409 &&
    upstream.problemCode === AUTHORED_LOCALIZATION_CODES.INCOMPLETE &&
    problem?.meta?.state === AUTHORED_LOCALIZATION_STATES.PENDING &&
    typeof problem.meta.fieldPath === "string"
  ) {
    upstream = await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}${suffix}`,
      {
        bearerToken: session.token,
        method: "GET",
      },
    );
    usedFallback = upstream.ok;
  }
  if (!upstream.ok || !options.responseSchema) return upstreamJson(upstream);
  const parsed = options.responseSchema.safeParse(
    usedFallback && upstream.data && typeof upstream.data === "object"
      ? {
          ...upstream.data,
          localizationFallback: true,
          ...(options.preservePendingCatalogReadiness
            ? {
                localizationState:
                  AUTHORED_LOCALIZATION_READINESS_STATES.PENDING,
              }
            : {}),
        }
      : upstream.data,
  );
  return parsed.success
    ? successJson(parsed.data, { status: upstream.status })
    : problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, { status: 502 });
}
