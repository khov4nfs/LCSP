"use client";
import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import * as C from "@lcsp/contracts/legal-rule-catalog";
import { apiValidated } from "./api-request";

export const legalRuleCatalogKey = ["admin", "legal-rule-catalog"] as const;
const root = "/api/admin/legal-rule-catalog";

/**
 * Business purpose: Read editable catalog identities for the integrated Preparation workflow.
 * Business rules:
 * - API session/Admin checks govern access; no catalog is created implicitly.
 * Execution flow:
 * 1. Register a validated read under the catalog cache key.
 * Failure cases:
 * - Transport, authorization and contract errors remain query errors.
 * Side effects:
 * - Read-only request and cache subscription.
 */
export function useLegalRuleCatalogs() {
  return useQuery({
    queryKey: [...legalRuleCatalogKey, "versions"],
    /**
     * Business purpose: Read the canonical catalog identities for the Admin chooser.
     * Business rules:
     * - The authenticated API owns which catalogs exist; never invent a default catalog.
     * Execution flow:
     * 1. Load and validate the catalog list through the shared client.
     * Failure cases:
     * - Transport, authorization and malformed responses reject the query.
     * Side effects:
     * - One read request; no rule selection or preparation is started.
     */
    queryFn: () => apiValidated(root, C.legalRuleCatalogListSchema),
  });
}

/**
 * Business purpose: Browse one server-filtered catalog page while selection remains independent.
 * Business rules:
 * - Catalog, page and filters partition the cache; the browser never computes Select all totals.
 * Execution flow:
 * 1. Register the page query
 * 2. Send bounded normalized query parameters.
 * Failure cases:
 * - Missing catalog disables the request; stale or denied responses remain errors.
 * Side effects:
 * - Read-only API/cache activity.
 */
export function useLegalRules(catalogId: string, query: C.LegalRuleList) {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
    search: query.search,
  });
  if (query.state) params.set("state", query.state);
  return useQuery({
    queryKey: [...legalRuleCatalogKey, "rules", catalogId, query],
    enabled: !!catalogId,
    /**
     * Business purpose: Read exactly the requested server-side rule page.
     * Business rules:
     * - Catalog identity and normalized filters must remain in the page request.
     * Execution flow:
     * 1. Call the rules endpoint and validate the returned page contract.
     * Failure cases:
     * - Invalid, missing and inaccessible catalogs remain query errors.
     * Side effects:
     * - One read request for rule eligibility and preparation state.
     */
    queryFn: () =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/rules?${params}`,
        C.legalRulePageSchema,
      ),
    refetchInterval: 3000,
  });
}

/**
 * Business purpose: Observe a selected Preparation Rule Set until its items finish independently.
 * Business rules:
 * - A failed item does not hide successful results; exact server membership owns all counts.
 * Execution flow:
 * 1. Read the batch identity
 * 2. Poll while any item remains active.
 * Failure cases:
 * - Missing identity disables reads; request errors never fabricate completion.
 * Side effects:
 * - Read-only polling and cache subscription.
 */
export function usePreparationRuleBatch(id: string | null) {
  return useQuery({
    queryKey: [...legalRuleCatalogKey, "batch", id],
    enabled: !!id,
    /**
     * Business purpose: Read the persisted selected build and its independent rule results.
     * Business rules:
     * - Only the requested batch identity determines membership and counts.
     * Execution flow:
     * 1. Fetch the batch through the shared validated request helper.
     * Failure cases:
     * - Missing or invalid batch responses remain visible read failures.
     * Side effects:
     * - One read request; does not restart any preparation item.
     */
    queryFn: () =>
      apiValidated(`${root}/preparations/${id}`, C.preparationRuleBatchSchema),
    /**
     * Business purpose: Refresh progress only while the selected build remains unfinished.
     * Business rules:
     * - Completion comes from the API, never from elapsed time or SSE connectivity.
     * Execution flow:
     * 1. Stop polling after acknowledged completion; otherwise poll after one second.
     * Failure cases:
     * - Absent response data keeps read polling enabled without fabricating completion.
     * Side effects:
     * - Updates polling cadence only; creates no model or preparation work.
     */
    refetchInterval: (query) => (query.state.data?.complete ? false : 1000),
  });
}

/**
 * Business purpose: Inspect and compare stored revisions for one canonical rule without starting work.
 * Business rules:
 * - The server identifies the current result and exact source/instruction pins.
 * Execution flow:
 * 1. Read history for the explicitly opened rule
 * 2. Refresh while the view is open.
 * Failure cases:
 * - Missing identity disables fetching; absent results remain an error rather than a generated substitute.
 * Side effects:
 * - Read-only requests and cache updates.
 */
export function usePreparationRuleHistory(ruleId: string | null) {
  return useInfiniteQuery({
    queryKey: [...legalRuleCatalogKey, "history", ruleId],
    enabled: !!ruleId,
    initialPageParam: null as number | null,
    /**
     * Business purpose: Page stored result history without generating new results.
     * Business rules:
     * - The server cursor stays within the chosen canonical rule; newest/current identities remain independent of the page.
     * Execution flow:
     * 1. Fetch and validate the next bounded history page.
     * Failure cases:
     * - Transport, access and malformed response errors remain query errors.
     * Side effects:
     * - Read-only request.
     */
    queryFn: ({ pageParam }) =>
      apiValidated(
        `${root}/rules/${ruleId}/results${pageParam ? `?beforeRevision=${pageParam}` : ""}`,
        C.preparationRuleHistorySchema,
      ),
    /**
     * Business purpose: Continue history only when the server exposes an older revision page.
     * Business rules:
     * - A null cursor ends pagination; the client never invents revision boundaries.
     * Execution flow:
     * 1. Return the validated server cursor.
     * Failure cases:
     * - No cursor yields no additional page request.
     * Side effects:
     * - Pure pagination decision.
     */
    getNextPageParam: (page) => page.nextBeforeRevision,
    /**
     * Business purpose: Make loaded result revisions available for side-by-side comparison.
     * Business rules:
     * - The newest page owns current/latest result identities; all loaded pages retain their persisted revisions.
     * Execution flow:
     * 1. Retain current metadata and flatten the ordered history pages.
     * Failure cases:
     * - Fetch failures remain query errors and do not fabricate older results.
     * Side effects:
     * - Pure presentation projection.
     */
    select: (data) => ({
      ...data.pages[0],
      results: data.pages.flatMap((page) => page.results),
    }),
    refetchInterval: ruleId ? 2000 : false,
  });
}

/**
 * Business purpose: Submit explicit catalog/selection/preparation commands through the shared validated client.
 * Business rules:
 * - Caller supplies the stable request identity; retries reuse that payload and server idempotency.
 * Execution flow:
 * 1. POST the chosen command
 * 2. Validate acknowledgement
 * 3. Refresh affected catalog reads.
 * Failure cases:
 * - API/transport/schema failures remain visible mutation errors without optimistic success.
 * Side effects:
 * - An explicitly invoked API mutation and cache invalidation.
 */
export function useLegalRuleCommand<TInput, TOutput>(
  path: string,
  schema: z.ZodType<TOutput>,
) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send one explicit catalog or preparation command to the API.
     * Business rules:
     * - Keep the caller's stable request identity and validate the API acknowledgement.
     * Execution flow:
     * 1. Serialize and POST the supplied command through the shared client.
     * Failure cases:
     * - Failed requests remain mutation errors without optimistic domain changes.
     * Side effects:
     * - One explicit upstream command; the API owns its transaction and dispatch.
     */
    mutationFn: (input: TInput) =>
      apiValidated(`${root}${path}`, schema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    /**
     * Business purpose: Refresh catalog and progress reads after an acknowledged command.
     * Business rules:
     * - Only a validated success invalidates cached reads; no successful result is guessed.
     * Execution flow:
     * 1. Invalidate the shared catalog query prefix for active subscriptions.
     * Failure cases:
     * - Cache failures propagate through the mutation lifecycle.
     * Side effects:
     * - Marks catalog and result queries stale and can trigger read refetches.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
  });
}
