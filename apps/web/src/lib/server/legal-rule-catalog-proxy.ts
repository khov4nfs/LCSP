import type { NextRequest } from "next/server";
import { z } from "zod";
import * as C from "@lcsp/contracts/legal-rule-catalog";
import { requireSessionToken } from "./session-token";
import { upstreamRequest, validatedUpstreamJson } from "./upstream-request";
import { problemJson } from "./problem-json";

const routes = [
  { method: "GET", pattern: /^$/, response: C.legalRuleCatalogListSchema },
  { method: "GET", pattern: /^[^/]+\/rules$/, response: C.legalRulePageSchema },
  {
    method: "GET",
    pattern: /^preparations\/[^/]+$/,
    response: C.preparationRuleBatchSchema,
  },
  {
    method: "GET",
    pattern: /^rules\/[^/]+\/results$/,
    response: C.preparationRuleHistorySchema,
  },
  {
    method: "GET",
    pattern: /^source-provisions$/,
    response: C.legalRuleSourceProvisionPageSchema,
  },
  {
    method: "POST",
    pattern: /^$/,
    request: C.legalRuleCatalogWriteSchema,
    response: C.legalRuleCatalogSchema,
  },
  {
    method: "POST",
    pattern: /^[^/]+\/rules$/,
    request: C.legalRuleWriteSchema,
    response: C.legalRuleSavedSchema,
  },
  {
    method: "POST",
    pattern: /^[^/]+\/source-provisions\/import$/,
    request: C.legalRuleSourceProvisionImportSchema,
    response: C.legalRuleSavedSchema,
  },
  {
    method: "POST",
    pattern: /^[^/]+\/assessment-rules\/activate$/,
    request: C.legalRuleActivationRequestSchema,
    response: C.legalRuleActivationResultSchema,
  },
  {
    method: "POST",
    pattern: /^selections$/,
    request: C.legalRuleSelectionSchema,
    response: C.legalRuleSelectionResultSchema,
  },
  {
    method: "POST",
    pattern: /^preparations$/,
    request: C.legalRuleBulkSchema,
    response: C.preparationRuleBatchSchema,
  },
  {
    method: "POST",
    pattern: /^preparations\/[^/]+\/retries$/,
    request: C.legalRuleRetrySchema,
    response: C.preparationRuleBatchSchema,
  },
  {
    method: "POST",
    pattern: /^rules\/[^/]+\/regenerate$/,
    request: C.legalRuleRegenerateSchema,
    response: C.preparationRuleBatchSchema,
  },
  {
    method: "POST",
    pattern: /^runs\/[^/]+\/cancel$/,
    request: z.strictObject({}),
    response: C.preparationRuleClaimSchema,
  },
  {
    method: "DELETE",
    pattern: /^[^/]+$/,
    response: C.legalRuleCatalogDeleteResponseSchema,
  },
];

/**
 * Business purpose: Proxy the Admin selected-rule workflow through the shared session and upstream envelope boundary.
 * Business rules:
 * - Only known methods/paths and validated payloads are forwarded; API Admin authorization remains authoritative.
 * Execution flow:
 * 1. Require session and match route
 * 2. Validate input
 * 3. Forward once and validate the response.
 * Failure cases:
 * - Unrecognized routes and invalid bodies return a typed problem; upstream authorization and stale-revision failures are preserved.
 * Side effects:
 * - One upstream read or explicit mutation; no domain or model work is executed in the BFF.
 */
export async function proxyLegalRuleCatalog(
  request: NextRequest,
  context: { params: Promise<{ segments?: string[] }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const segments = (await context.params).segments ?? [];
  const path = segments.join("/");
  const route = routes.find(
    (item) => item.method === request.method && item.pattern.test(path),
  );
  if (!route)
    return problemJson(C.LEGAL_RULE_CATALOG_ERRORS.NOT_FOUND, { status: 404 });
  let body: string | undefined;
  if ("request" in route && route.request) {
    const parsed = route.request.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return problemJson(C.LEGAL_RULE_CATALOG_ERRORS.INVALID, { status: 422 });
    body = JSON.stringify(parsed.data);
  }
  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/legal-rule-catalog${path ? `/${segments.map(encodeURIComponent).join("/")}` : ""}${request.nextUrl.search}`,
      {
        bearerToken: session.token,
        method: request.method,
        ...(body
          ? { body, headers: { "content-type": "application/json" } }
          : {}),
      },
    ),
    (data) => {
      const parsed = route.response.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
