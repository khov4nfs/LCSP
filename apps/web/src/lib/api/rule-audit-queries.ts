"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ruleAuditCatalogSchema,
  ruleAuditRequestViewSchema,
  type SubmitRuleAudit,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated } from "./api-request";

export const ruleAuditKeys = {
  /**
   * Business purpose: Identify the complete pinned catalog cache for one assessment.
   * Business rules:
   * - Assessment identity partitions owner-scoped catalog projections.
   * Execution flow:
   * 1. Build the stable catalog key.
   * Failure cases:
   * - No hidden fallback key is used for a missing assessment identity.
   * Side effects:
   * - Pure cache-key construction.
   */
  catalog: (id: string) => ["assessment", id, "rule-audit-catalog"] as const,
  /**
   * Business purpose: Identify one immutable request's live progress cache.
   * Business rules:
   * - Request identity separates later audit runs on the same assessment.
   * Execution flow:
   * 1. Build the assessment and request key.
   * Failure cases:
   * - The caller disables querying when the request ID is absent.
   * Side effects:
   * - Pure cache-key construction.
   */
  request: (id: string, requestId: string) => ["assessment", id, "rule-audit", requestId] as const,
};

/**
 * Business purpose: Present the full pinned customer catalog, including rules beyond the first page.
 * Business rules:
 * - A partial page must never become the authority for Select all or customer counts.
 * Execution flow:
 * 1. Load consecutive server pages until nextOffset is null.
 * 2. Reject a looping cursor and return one aggregated read model.
 * Failure cases:
 * - Invalid pages or a repeated cursor fail the query rather than omitting rules.
 * Side effects:
 * - Read-only owner-scoped BFF requests and TanStack cache population.
 */
export function useRuleAuditCatalogQuery(id: string) {
  return useQuery({
    queryKey: ruleAuditKeys.catalog(id), enabled: Boolean(id),
    /**
     * Business purpose: Assemble the entire pinned catalog for explicit customer selection.
     * Business rules:
     * - Every page must be read and counts must match before Select all becomes available.
     * Execution flow:
     * 1. Follow each next offset. 2. Reject repeated cursors. 3. Validate the combined catalog.
     * Failure cases:
     * - Incomplete pages or looped pagination reject the query.
     * Side effects:
     * - Performs owner-scoped reads; no audit starts.
     */
    queryFn: async () => {
      let offset = 0;
      let first: Awaited<ReturnType<typeof loadPage>> | null = null;
      const rules: Awaited<ReturnType<typeof loadPage>>["rules"] = [];
      const seen = new Set<number>();
      while (true) {
        if (seen.has(offset)) throw new Error("Rule catalog cursor repeated");
        seen.add(offset);
        const page = await loadPage(id, offset);
        first ??= page;
        rules.push(...page.rules);
        if (page.nextOffset === null) {
          if (rules.length !== page.total) throw new Error("Rule catalog incomplete");
          return ruleAuditCatalogSchema.parse({ ...first, rules, nextOffset: null });
        }
        offset = page.nextOffset;
      }
    },
  });
}

/**
 * Business purpose: Fetch one bounded page from the assessment's pinned selectable catalog.
 * Business rules:
 * - The API response schema is required before adding a page to Select all.
 * Execution flow:
 * 1. Request the next offset and validate the envelope.
 * Failure cases:
 * - Network, ownership and schema failures reject the caller.
 * Side effects:
 * - One read-only BFF request.
 */
async function loadPage(id: string, offset: number) {
  return apiValidated(
    `/api/assessments/${encodeURIComponent(id)}/rules?offset=${offset}&limit=100`,
    ruleAuditCatalogSchema,
  );
}

/**
 * Business purpose: Keep an accepted request and its progress fresh across SSE and reloads.
 * Business rules:
 * - The server request ID is the only authority for selected membership.
 * Execution flow:
 * 1. Read and validate the owner-scoped request whenever its key is active.
 * Failure cases:
 * - Missing or invalid request stays an error, not a fabricated empty result.
 * Side effects:
 * - One read-only BFF request and query cache updates.
 */
export function useRuleAuditRequestQuery(id: string, requestId: string | null) {
  return useQuery({
    queryKey: ruleAuditKeys.request(id, requestId ?? ""), enabled: Boolean(id && requestId),
    /**
     * Business purpose: Reload durable per-rule status for one frozen request.
     * Business rules:
     * - The owner API is authoritative for accepted decisions and stale state.
     * Execution flow:
     * 1. Fetch and validate the request projection.
     * Failure cases:
     * - API and schema failures reject without optimistic results.
     * Side effects:
     * - Read-only owner-scoped BFF request.
     */
    queryFn: () => apiValidated(
      `/api/assessments/${encodeURIComponent(id)}/rule-audits/${encodeURIComponent(requestId!)}`,
      ruleAuditRequestViewSchema,
    ),
  });
}

/**
 * Business purpose: Submit one explicit frozen customer choice and refresh its authoritative projection.
 * Business rules:
 * - The caller supplies a stable idempotency key for retries; no optimistic verdict is created.
 * Execution flow:
 * 1. POST the validated selection.
 * 2. Refresh catalog, detail and events after acceptance.
 * Failure cases:
 * - Rejected scope leaves cache and old decisions intact.
 * Side effects:
 * - One owner-scoped audit request and query invalidations.
 */
export function useSubmitRuleAudit(id: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send a frozen selected-rule audit choice.
     * Business rules:
     * - Exact pins and a stable retry key travel unchanged to the API.
     * Execution flow:
     * 1. POST and validate the persisted request response.
     * Failure cases:
     * - Rejected scope remains a mutation error with prior results intact.
     * Side effects:
     * - Submits one owner-scoped audit request.
     */
    mutationFn: (body: SubmitRuleAudit) => apiValidated(
      `/api/assessments/${encodeURIComponent(id)}/rule-audits`,
      ruleAuditRequestViewSchema,
      { method: "POST", body: JSON.stringify(body) },
    ),
    /**
     * Business purpose: Show the newly persisted scope and Root progress.
     * Business rules:
     * - Canonical server projections replace all stale local assessment reads.
     * Execution flow:
     * 1. Invalidate this assessment's active queries.
     * Failure cases:
     * - Refetch errors remain query errors, not fabricated status.
     * Side effects:
     * - Invalidates TanStack cache entries.
     */
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["assessment", id] });
    },
  });
}

/**
 * Business purpose: Resume the exact failed selected scope with a replay-safe retry identity.
 * Business rules:
 * - The server retains membership, checkpoint and paid usage authority.
 * Execution flow:
 * 1. POST the failed request's stable retry key.
 * 2. Refresh all assessment projections after the server accepts it.
 * Failure cases:
 * - A stale or nonfailed request stays an error with its earlier results available.
 * Side effects:
 * - Enqueues one Root retry through the owner-scoped BFF and invalidates queries.
 */
export function useRetryRuleAudit(id: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Retry a failed request under its original frozen membership.
     * Business rules:
     * - Request ID and retry key are required for safe server replay.
     * Execution flow:
     * 1. POST and validate the current request projection.
     * Failure cases:
     * - Stale or active requests remain rejected with earlier results visible.
     * Side effects:
     * - Sends one owner-scoped retry command.
     */
    mutationFn: ({ requestId, idempotencyKey }: { requestId: string; idempotencyKey: string }) =>
      apiValidated(`/api/assessments/${encodeURIComponent(id)}/rule-audits/${encodeURIComponent(requestId)}/retry`,
        ruleAuditRequestViewSchema, { method: "POST", body: JSON.stringify({ idempotencyKey }) }),
    /**
     * Business purpose: Refresh failed-request progress after retry acceptance.
     * Business rules:
     * - Server state stays authoritative for checkpoint and decision recovery.
     * Execution flow:
     * 1. Invalidate active assessment queries.
     * Failure cases:
     * - Failed refetch leaves a query error rather than a local verdict.
     * Side effects:
     * - Invalidates TanStack cache entries.
     */
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["assessment", id] });
    },
  });
}
