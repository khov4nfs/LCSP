import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  AUTHORED_LOCALIZATION_CODES,
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_STATES,
  authoredBatchOutputReviewSchema,
  authoredBatchReviewResultSchema,
  authoredBatchSourceReviewSchema,
  authoredCandidateActionSchema,
  authoredLocalizationBacklogResponseSchema,
  authoredLocalizationQueueResponseSchema,
  authoredOutputReviewSchema,
  authoredSourceReviewSchema,
} from "@lcsp/contracts/assessment-domain";
import { requireSessionToken } from "./session-token";
import { upstreamRequest, validatedUpstreamJson } from "./upstream-request";
import { problemJson } from "./problem-json";

/**
 * Business purpose: Expose the bounded Admin localization backlog across scopes.
 * Business rules:
 * - Session credentials are forwarded through shared upstream transport; API Admin authorization remains mandatory.
 * Execution flow:
 * 1. Require the session, normalize optional filters, read backlog and validate the public response schema.
 * Failure cases:
 * - Missing sessions, invalid filters and upstream errors return shared problems.
 * Side effects:
 * - Performs one read without invoking translation providers or modifying provenance.
 */
export async function proxyLocalizationBacklog(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const afterScopeId =
    request.nextUrl.searchParams.get("afterScopeId")?.trim() ?? undefined;
  const entityTypeRaw =
    request.nextUrl.searchParams.get("entityType")?.trim() ?? undefined;
  if (
    entityTypeRaw &&
    !z.enum(AUTHORED_LOCALIZATION_ENTITIES).safeParse(entityTypeRaw).success
  )
    return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
      status: 422,
    });
  const params = new URLSearchParams();
  if (afterScopeId) params.set("afterScopeId", afterScopeId);
  if (entityTypeRaw) params.set("entityType", entityTypeRaw);
  const query = params.toString();
  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/localization${query ? `?${query}` : ""}`,
      {
        bearerToken: session.token,
      },
    ),
    (data) => {
      const parsed = authoredLocalizationBacklogResponseSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}

/**
 * Business purpose: Forward the authenticated Admin localization review workflow through validated API contracts.
 * Business rules:
 * - Only known paths/methods and validated schemas pass; backend Admin authorization and hash/revision checks remain authoritative.
 * Execution flow:
 * 1. Validate session/path/body, forward the exact action and validate the returned public schema.
 * Failure cases:
 * - Invalid actions, malformed bodies and upstream authorization or governance errors remain explicit failures.
 * Side effects:
 * - Performs one scoped upstream review read, single review, batch review, rejection or retry.
 */
export async function proxyLocalizationScope(
  request: NextRequest,
  context: { params: Promise<{ scopeId: string; action?: string[] }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { scopeId, action = [] } = await context.params;
  if (!scopeId.trim())
    return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
      status: 422,
    });

  if (request.method === "GET") {
    if (action.length !== 0)
      return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
        status: 422,
      });
    const after = request.nextUrl.searchParams.get("after")?.trim();
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return validatedUpstreamJson(
      await upstreamRequest(
        `/admin/localization/${encodeURIComponent(scopeId)}${query}`,
        {
          bearerToken: session.token,
        },
      ),
      (data) => {
        const parsed = authoredLocalizationQueueResponseSchema.safeParse(data);
        return parsed.success ? parsed.data : null;
      },
    );
  }

  if (request.method !== "POST")
    return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
      status: 422,
    });

  const payload = await request.json().catch(() => null);
  if (action.length === 1) {
    const [batchCommand] = action;
    if (
      batchCommand !== "batch-source-review" &&
      batchCommand !== "batch-output-review"
    )
      return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
        status: 422,
      });
    const parsed = (
      batchCommand === "batch-source-review"
        ? authoredBatchSourceReviewSchema
        : authoredBatchOutputReviewSchema
    ).safeParse(payload);
    if (!parsed.success)
      return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
        status: 422,
      });
    return validatedUpstreamJson(
      await upstreamRequest(
        `/admin/localization/${encodeURIComponent(scopeId)}/${batchCommand}`,
        {
          bearerToken: session.token,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      ),
      (data) => {
        const result = authoredBatchReviewResultSchema.safeParse(data);
        return result.success ? result.data : null;
      },
    );
  }

  if (action.length === 2) {
    const [requestId, itemCommand] = action;
    if (
      !z.uuid().safeParse(requestId).success ||
      !["source-review", "output-review", "retry"].includes(itemCommand)
    )
      return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
        status: 422,
      });
    const requestSchema =
      itemCommand === "source-review"
        ? authoredSourceReviewSchema
        : itemCommand === "output-review"
          ? authoredOutputReviewSchema
          : authoredCandidateActionSchema;
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success)
      return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
        status: 422,
      });
    const responseSchema =
      itemCommand === "source-review"
        ? z.object({ reviewed: z.number().int().nonnegative() })
        : itemCommand === "output-review"
          ? z.object({ state: z.literal(AUTHORED_LOCALIZATION_STATES.READY) })
          : z.object({
              id: z.string().min(1),
              state: z.enum(AUTHORED_LOCALIZATION_STATES),
              translationRevision: z.number().int().positive(),
            });
    return validatedUpstreamJson(
      await upstreamRequest(
        `/admin/localization/${encodeURIComponent(scopeId)}/${encodeURIComponent(requestId)}/${itemCommand}`,
        {
          bearerToken: session.token,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      ),
      (data) => {
        const result = responseSchema.safeParse(data);
        return result.success ? result.data : null;
      },
    );
  }

  return problemJson(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID, {
    status: 422,
  });
}
