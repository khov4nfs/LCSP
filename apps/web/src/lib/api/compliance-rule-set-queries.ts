"use client";
import { preparationActivityPageSchema } from "@lcsp/contracts/evidence";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import {
  complianceRuleSetHistorySchema,
  complianceRuleSetResultSchema,
  ruleSetPreparationRunSchema,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  type ComplianceRuleSetHistory,
  preparationSourceUnitsRequestSchema,
  preparationSourceUnitsResponseSchema,
  preparationSourceUnitDetailRequestSchema,
  preparationSourceUnitDetailResponseSchema,
  preparationGeneratedCatalogRequestSchema,
  preparationGeneratedCatalogResponseSchema,
  type PreparationGeneratedCatalogRequest,
  type PreparationGeneratedCatalogResponse,
  type PreparationSourceUnitsRequest,
  type PreparationSourceUnitDetailResponse,
  type RuleSetPreparationAdminRequest,
} from "@lcsp/contracts/compliance-rule-set";
import { apiValidated } from "./api-request";
const historyKey = ["admin", "compliance-rule-sets"];
export const RULE_SET_PREPARATION_CANCEL_MUTATION_KEY = [
  "admin",
  "compliance-rule-sets",
  "cancel-preparation",
] as const;
export function useComplianceRuleSetHistoryQuery() {
  return useQuery({
    queryKey: historyKey,
    queryFn: () =>
      apiValidated(
        "/api/admin/compliance-rule-sets",
        complianceRuleSetHistorySchema,
      ),
    refetchInterval: 5000,
  });
}

/**
 * Business purpose: Read a cursor-paginated, revision-pinned Source Analysis list for one Admin Preparation run.
 *
 * Business rules:
 * - Fetch only when both run identity and persisted inventory revision are available.
 * - Keep run, revision, and normalized filters in the query identity so pages cannot cross scopes.
 * - Use server-issued cursors and the shared response validator; the browser never reconstructs coverage.
 *
 * Execution flow:
 * 1. Register an infinite query scoped to run, revision, and filters.
 * 2. Validate each bounded page request and call the authenticated source-units BFF.
 * 3. Continue only with the server-issued next cursor; reset the exact query to refresh a stale frontier.
 *
 * Failure cases:
 * - Missing identity disables fetching; request, transport, authorization, and response-schema failures remain query errors.
 *
 * Side effects:
 * - Read-only BFF requests and React Query cache updates; no Preparation data is written.
 */
export function usePreparationSourceUnitsQuery(
  preparationRunId: string | null,
  inventoryRevision: number | null,
  filters: Pick<
    PreparationSourceUnitsRequest,
    "state" | "documentId" | "search"
  >,
) {
  const client = useQueryClient();
  const normalizedFilters = normalizePreparationSourceUnitsFilters(filters);
  const queryKey = preparationSourceUnitsQueryKey(
    preparationRunId,
    inventoryRevision,
    normalizedFilters,
  );
  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(preparationRunId && inventoryRevision),
    initialPageParam: null as string | null,
    /**
     * Business purpose: Fetch one persisted page from the selected Preparation frontier.
     *
     * Business rules:
     * - Bind every request to the selected run and inventory revision, validate bounded filters, and use only a server-issued cursor.
     *
     * Execution flow:
     * 1. Validate the request DTO and construct its query string.
     * 2. Call the authenticated Admin BFF and validate the response contract.
     *
     * Failure cases:
     * - Missing identity, invalid request values, authorization, transport, and response-schema failures reject the page.
     *
     * Side effects:
     * - One read-only BFF request; no run or frontier state is changed.
     */
    /**
     * Business purpose: Fetch one bounded catalog page from the authorized Admin BFF.
     *
     * Business rules:
     * - A request requires the selected run and exact persisted inventory revision, and all page parameters are validated against the shared contract.
     * - The browser forwards only the current kind, search, and server-issued cursor; it does not paginate a full catalog locally.
     *
     * Execution flow:
     * 1. Reject missing run/revision identity if a disabled query is invoked directly.
     * 2. Validate and serialize the page request, then validate the response envelope payload.
     *
     * Failure cases:
     * - Invalid scope, unavailable session, upstream problems, stale cursors, and invalid response data reject the query.
     *
     * Side effects:
     * - One read-only BFF request and a scoped React Query cache update.
     */
    queryFn: ({ pageParam, signal }) => {
      if (!preparationRunId || inventoryRevision === null) {
        throw new Error("Source Analysis identity is unavailable");
      }
      const request = preparationSourceUnitsRequestSchema.parse({
        inventoryRevision,
        limit: 50,
        ...normalizedFilters,
        cursor: pageParam ?? undefined,
      });
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(request)) {
        if (value !== undefined) params.set(key, String(value));
      }
      return apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/source-units?${params}`,
        preparationSourceUnitsResponseSchema,
        { signal },
      );
    },
    /**
     * Business purpose: Continue the source list only when the server declares another page.
     *
     * Business rules:
     * - Use the response's opaque nextCursor and never synthesize or restart a cursor.
     *
     * Execution flow:
     * 1. Return the next cursor only when hasMore is true.
     *
     * Failure cases:
     * - A missing next cursor ends pagination and leaves the already validated page unchanged.
     *
     * Side effects:
     * - Pure pagination decision; no request occurs until React Query fetches the next page.
     */
    /**
     * Business purpose: Continue a catalog collection only when the server reports another bounded page.
     *
     * Business rules:
     * - The next identity must be the server-issued cursor; the client never manufactures or resets a cursor.
     *
     * Execution flow:
     * 1. Return nextCursor when hasMore is true and otherwise end the infinite query.
     *
     * Failure cases:
     * - Missing cursor ends pagination rather than replaying the first page.
     *
     * Side effects:
     * - Pure pagination decision; no request occurs until the user fetches another page.
     */
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
  });
  return {
    ...query,
    /**
     * Business purpose: Recover from a frontier change or failed cursor by starting this exact query from page one.
     *
     * Business rules:
     * - Reset only the current run, revision, and filter key; never reuse its stale next cursor.
     *
     * Execution flow:
     * 1. Ask React Query to reset the exact source-unit key, which refetches the first page when active.
     *
     * Failure cases:
     * - Any first-page request error remains visible through the query result.
     *
     * Side effects:
     * - Resets and refetches the selected query cache entry; backend state is read-only.
     */
    refreshFromFirstPage: () => client.resetQueries({ queryKey, exact: true }),
  };
}

/**
 * Business purpose: Produce the stable cache identity for one bounded source-unit query.
 *
 * Business rules:
 * - Separate runs, inventory revisions, review states, documents, and search terms so cached pages never cross selected scopes.
 * - Normalize blank optional filters to absence before building the key.
 *
 * Execution flow:
 * 1. Normalize the supplied filters.
 * 2. Return a key containing the shared Admin prefix, run, revision, and normalized filter object.
 *
 * Failure cases:
 * - Missing run or revision remains represented in the key; the hook separately disables fetching.
 *
 * Side effects:
 * - Pure cache-key construction; no request or persistence change.
 */
export function preparationSourceUnitsQueryKey(
  preparationRunId: string | null,
  inventoryRevision: number | null,
  filters: Pick<
    PreparationSourceUnitsRequest,
    "state" | "documentId" | "search"
  >,
) {
  return [
    ...historyKey,
    "source-units",
    preparationRunId,
    inventoryRevision,
    normalizePreparationSourceUnitsFilters(filters),
  ] as const;
}

/**
 * Business purpose: Retrieve the persisted review detail for one selected Explorer source unit.
 *
 * Business rules:
 * - Cache identity includes run, inventory revision, and sourceNodeId; fetching is disabled unless all three are present.
 * - The endpoint response is accepted only after shared DTO validation, and detail is never fetched for every Explorer row.
 *
 * Execution flow:
 * 1. Register a source-unit-scoped query and validate the required inventory revision.
 * 2. Call the authenticated BFF for the selected node and validate the complete response contract.
 *
 * Failure cases:
 * - Missing identity disables the query; authorization, stale pins, invalid payload, transport, and schema errors remain visible as query errors.
 *
 * Side effects:
 * - One read-only BFF request for the currently selected unit and a scoped React Query cache entry.
 */
export function usePreparationSourceUnitDetailQuery(
  preparationRunId: string | null,
  inventoryRevision: number | null,
  sourceNodeId: string | null,
) {
  return useQuery<PreparationSourceUnitDetailResponse>({
    queryKey: preparationSourceUnitDetailQueryKey(
      preparationRunId,
      inventoryRevision,
      sourceNodeId,
    ),
    enabled: Boolean(
      preparationRunId && inventoryRevision !== null && sourceNodeId,
    ),
    /**
     * Business purpose: Load the currently selected source unit's persisted detail for the Admin modal.
     *
     * Business rules:
     * - Require all run, revision, and source-node identities and validate the revision before issuing a request.
     * - Accept only the shared detail response contract from the authenticated BFF.
     *
     * Execution flow:
     * 1. Reject a missing selected identity if the disabled query is invoked directly.
     * 2. Build the bounded revision query and fetch the selected source-node route with cancellation support.
     *
     * Failure cases:
     * - Invalid identity, session failure, stale source pins, transport error, or response-schema mismatch rejects the query.
     *
     * Side effects:
     * - One read-only authenticated BFF request; React Query stores only the result under the exact source identity key.
     */
    queryFn: ({ signal }) => {
      if (!preparationRunId || inventoryRevision === null || !sourceNodeId) {
        throw new Error("Source unit detail identity is unavailable");
      }
      const request = preparationSourceUnitDetailRequestSchema.parse({
        inventoryRevision,
      });
      const params = new URLSearchParams({
        inventoryRevision: String(request.inventoryRevision),
      });
      return apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/source-units/${encodeURIComponent(sourceNodeId)}?${params}`,
        preparationSourceUnitDetailResponseSchema,
        { signal },
      );
    },
  });
}

/**
 * Business purpose: Isolate one source detail cache entry from every other run, revision, and source unit.
 *
 * Business rules:
 * - The complete canonical source identity is included even when a required identity is unavailable.
 *
 * Execution flow:
 * 1. Return a stable detail key under the shared Admin Rule Set history prefix.
 *
 * Failure cases:
 * - No identity is inferred; callers disable the corresponding query until all pins are available.
 *
 * Side effects:
 * - Pure key construction; no query or network request is started.
 */
export function preparationSourceUnitDetailQueryKey(
  preparationRunId: string | null,
  inventoryRevision: number | null,
  sourceNodeId: string | null,
) {
  return [
    ...historyKey,
    "source-unit-detail",
    preparationRunId,
    inventoryRevision,
    sourceNodeId,
  ] as const;
}

/**
 * Business purpose: Load pages from the selected Preparation's persisted Rule Set catalog.
 *
 * Business rules:
 * - Fetch only with a run and persisted inventory revision; kind, normalized search, and page size separate cached collections.
 * - Server-issued cursors remain page parameters, and catalog source/version binding is validated by the backend on every continuation.
 *
 * Execution flow:
 * 1. Register an infinite query under the exact run/revision/kind/search identity.
 * 2. Validate each bounded page request and call the authenticated Catalog BFF.
 * 3. Continue only with the response's next cursor; expose an explicit first-page refresh for stale cursors.
 *
 * Failure cases:
 * - Missing identity disables fetching; contract, authorization, persistence, and stale-cursor errors stay visible to the view.
 *
 * Side effects:
 * - Read-only BFF requests and scoped cache updates; no catalog records are written.
 */
export function usePreparationGeneratedCatalogQuery(
  preparationRunId: string | null,
  inventoryRevision: number | null,
  kind: PreparationGeneratedCatalogRequest["kind"],
  search: string,
) {
  const client = useQueryClient();
  const normalizedSearch = search.trim() || undefined;
  const queryKey = preparationGeneratedCatalogQueryKey(
    preparationRunId,
    inventoryRevision,
    kind,
    normalizedSearch,
  );
  const query = useInfiniteQuery<PreparationGeneratedCatalogResponse>({
    queryKey,
    enabled: Boolean(preparationRunId && inventoryRevision !== null),
    initialPageParam: null as string | null,
    /**
     * Business purpose: Read one bounded page from the selected preparation catalog.
     *
     * Business rules:
     * - Requests require the selected run and exact inventory revision; the shared request schema enforces supported kind, search, and cursor values.
     *
     * Execution flow:
     * 1. Validate the page request, serialize its bounded parameters, then call the authenticated Admin BFF with the query cancellation signal.
     *
     * Failure cases:
     * - Missing identity, request validation, authorization, response validation, and server errors reject the page request for the query state to expose.
     *
     * Side effects:
     * - Performs a read-only authenticated BFF request; it does not mutate catalog data.
     */
    queryFn: ({ pageParam, signal }) => {
      if (!preparationRunId || inventoryRevision === null) {
        throw new Error("Generated catalog identity is unavailable");
      }
      const input = preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision,
        kind,
        limit: 50,
        ...(normalizedSearch ? { search: normalizedSearch } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) params.set(key, String(value));
      }
      return apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/catalog?${params}`,
        preparationGeneratedCatalogResponseSchema,
        { signal },
      );
    },
    /**
     * Business purpose: Continue server-side pagination only when the returned page declares another page.
     *
     * Business rules:
     * - The server-issued opaque cursor is the sole continuation authority; an absent cursor ends pagination.
     *
     * Execution flow:
     * 1. Read `hasMore` and `nextCursor` from the validated response and return the cursor only for a continuing page.
     *
     * Failure cases:
     * - A stale cursor remains an upstream query error and is not replaced with a page-one request.
     *
     * Side effects:
     * - Pure pagination decision over the validated response; performs no request or persistence itself.
     */
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
  });
  return {
    ...query,
    /**
     * Business purpose: Recover from a stale or failed catalog cursor by refreshing only the current collection identity.
     *
     * Business rules:
     * - Reset the exact run, revision, kind, search, and page-size cache key; do not reuse a stale page parameter.
     *
     * Execution flow:
     * 1. Reset the current infinite query so its first page can be fetched again.
     *
     * Failure cases:
     * - A failed first-page request remains visible as the query error.
     *
     * Side effects:
     * - Clears and refetches the scoped client cache; backend data is unchanged.
     */
    refreshFromFirstPage: () => client.resetQueries({ queryKey, exact: true }),
  };
}

/**
 * Business purpose: Isolate cached catalog pages by the complete selected read scope.
 *
 * Business rules:
 * - Run, revision, collection kind, and normalized search form distinct identities; infinite-query cursor values are isolated as page parameters within that key.
 *
 * Execution flow:
 * 1. Normalize whitespace-only search to absence.
 * 2. Return the stable Admin catalog query key including the fixed bounded page size.
 *
 * Failure cases:
 * - Missing run or revision remains represented and the hook disables its request.
 *
 * Side effects:
 * - Pure key construction; no request or persistence change.
 */
export function preparationGeneratedCatalogQueryKey(
  preparationRunId: string | null,
  inventoryRevision: number | null,
  kind: PreparationGeneratedCatalogRequest["kind"],
  search: string | undefined,
) {
  return [
    ...historyKey,
    "preparation-catalog",
    preparationRunId,
    inventoryRevision,
    kind,
    search?.trim() || null,
    50,
  ] as const;
}

/**
 * Business purpose: Canonicalize optional Source Analysis filters before cache identity and request construction.
 *
 * Business rules:
 * - Empty state, document, and search values represent no filter; non-empty text is trimmed.
 *
 * Execution flow:
 * 1. Preserve the selected shared-contract state and trim optional text filters.
 *
 * Failure cases:
 * - Invalid non-empty values are rejected by the request schema before an API call.
 *
 * Side effects:
 * - Pure value normalization; no cache, network, or persistence mutation.
 */
function normalizePreparationSourceUnitsFilters(
  filters: Pick<
    PreparationSourceUnitsRequest,
    "state" | "documentId" | "search"
  >,
) {
  return {
    state: filters.state || undefined,
    documentId: filters.documentId?.trim() || undefined,
    search: filters.search?.trim() || undefined,
  };
}
/**
 * Business purpose: Cache the Admin result of one immutable Rule Set version.
 *
 * Business rules:
 * - Key the result by its supplied version ID and use the shared validated API client.
 *
 * Execution flow:
 * 1. Register the version-scoped query and its typed result loader.
 *
 * Failure cases:
 * - API, schema and transport failures remain query errors; no fallback result is invented.
 *
 * Side effects:
 * - Registers a React Query subscription; fetching occurs through its loader.
 */
export function useComplianceRuleSetResultQuery(ruleSetVersionId: string) {
  return useQuery({
    queryKey: [...historyKey, "result", ruleSetVersionId],
    /**
     * Business purpose: Retrieve the requested Rule Set result for the Admin query cache.
     *
     * Business rules:
     * - Encode the requested version ID and require complianceRuleSetResultSchema.
     *
     * Execution flow:
     * 1. Call the shared validated client for that result endpoint.
     *
     * Failure cases:
     * - Client/API/schema failures reject the query.
     *
     * Side effects:
     * - One authenticated BFF read.
     */
    queryFn: () =>
      apiValidated(
        `/api/admin/compliance-rule-sets/${encodeURIComponent(ruleSetVersionId)}`,
        complianceRuleSetResultSchema,
      ),
  });
}
/**
 * Business purpose: Coordinate Admin Preparation submission and history-cache refresh.
 *
 * Business rules:
 * - Only an acknowledged server run updates existing history; preserve the active Rule Set
 *   identity and let the API enforce admission.
 *
 * Execution flow:
 * 1. Register the POST mutation, acknowledged-run cache update and settled history
 *   invalidation.
 *
 * Failure cases:
 * - A failed request remains a mutation error; absent cached history is not manufactured.
 *
 * Side effects:
 * - Registers a mutation and its cache effects; the API owns actual Preparation execution.
 */
export function usePrepareRuleSetMutation() {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Submit the Admin’s validated-contract Preparation request.
     *
     * Business rules:
     * - Send the request as JSON and validate the returned Preparation run through apiValidated.
     *
     * Execution flow:
     * 1. POST the supplied request to the canonical Preparation BFF endpoint.
     *
     * Failure cases:
     * - API/schema/network errors reject the mutation.
     *
     * Side effects:
     * - One upstream Preparation request via the BFF.
     */
    mutationFn: (request: RuleSetPreparationAdminRequest) =>
      apiValidated(
        "/api/admin/compliance-rule-sets/prepare",
        ruleSetPreparationRunSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      ),
    /**
     * Business purpose: Project an acknowledged in-progress Preparation into existing Admin
     *   history.
     *
     * Business rules:
     * - Disable start/replace while the returned run is current; retain the existing active Rule
     *   Set and leave an absent history cache absent.
     *
     * Execution flow:
     * 1. Update cached Preparation availability, refusal reason and current run from the server
     *   result.
     *
     * Failure cases:
     * - If history was not cached, return it unchanged rather than create a guessed projection.
     *
     * Side effects:
     * - Updates only React Query history data.
     */
    onSuccess: (run) => {
      client.setQueryData<ComplianceRuleSetHistory>(historyKey, (history) =>
        history
          ? {
              ...history,
              preparation: {
                ...history.preparation,
                canStart: false,
                canReplace: false,
                activeRuleSetVersionId:
                  history.preparation.activeRuleSetVersionId,
                refusalReason:
                  RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
                currentRun: run,
              },
            }
          : history,
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}

/** Retries one FAILED Rule Set Preparation of the same Legal Source Version. */
export function useRetryRuleSetPreparationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (preparationRunId: string) =>
      apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/retries`,
        ruleSetPreparationRunSchema,
        { method: "POST" },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}

/** Cancels one queued/running preparation through the Admin API. */
export function useCancelRuleSetPreparationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: RULE_SET_PREPARATION_CANCEL_MUTATION_KEY,
    mutationFn: (preparationRunId: string) =>
      apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/cancel`,
        ruleSetPreparationRunSchema,
        { method: "POST" },
      ),
    onSettled: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}

/**
 * Business purpose: Coordinate resuming an existing Preparation and refreshing its history.
 *
 * Business rules:
 * - Use the same run identity; invalidate history on either success or failure so the next
 *   view follows server state.
 *
 * Execution flow:
 * 1. Register the resume POST loader and settled invalidation.
 *
 * Failure cases:
 * - Resume failures remain mutation errors; they do not imply a new run or success.
 *
 * Side effects:
 * - Registers the mutation and subsequent cache invalidation.
 */
export function useResumeRuleSetPreparationMutation() {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request native continuation of the specified existing Preparation.
     *
     * Business rules:
     * - Encode the run ID and validate ruleSetPreparationRunSchema; backend guards decide whether
     *   resume is allowed.
     *
     * Execution flow:
     * 1. POST to the existing run’s resume BFF endpoint.
     *
     * Failure cases:
     * - API, schema or transport failures reject without fabricated run state.
     *
     * Side effects:
     * - One upstream resume request.
     */
    mutationFn: (preparationRunId: string) =>
      apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/resume`,
        ruleSetPreparationRunSchema,
        { method: "POST" },
      ),
    /**
     * Business purpose: Refresh Admin history after any resume outcome.
     *
     * Business rules:
     * - Invalidate the shared history prefix regardless of request success.
     *
     * Execution flow:
     * 1. Return the history invalidation promise.
     *
     * Failure cases:
     * - Cache invalidation errors propagate through React Query’s mutation lifecycle.
     *
     * Side effects:
     * - Marks matching history/result queries stale and may trigger active refetches.
     */
    onSettled: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}

/**
 * Business purpose: Page older persisted Preparation events independently from live SSE connectivity.
 * Business rules:
 * - Run identity partitions caches; server cursors and cancellation govern exact historical pages.
 * Execution flow:
 * 1. Load the newest bounded journal page and request older pages only on operator intent.
 * Failure cases:
 * - Authorization, network and schema errors remain visible; failure never marks a build failed.
 * Side effects:
 * - Read-only journal requests through the BFF.
 */
export function usePreparationActivityHistory(runId: string | null) {
  return useInfiniteQuery({
    queryKey: ["admin", "preparation-activity", runId],
    enabled: Boolean(runId),
    initialPageParam: null as string | null,
    /**
     * Business purpose: Fetch one server-owned event window.
     * Business rules:
     * - Exact run and cursor are mandatory identities; never infer completeness from SSE.
     * Execution flow:
     * 1. Forward cursor, limit and cancellation to the validated API helper.
     * Failure cases:
     * - Incomplete or forbidden responses reject the page query.
     * Side effects:
     * - Reads persisted telemetry only.
     */
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (pageParam) params.set("cursor", pageParam);
      return apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(runId!)}/activity?${params}`,
        preparationActivityPageSchema,
        { signal },
      );
    },
    /**
     * Business purpose: Follow the server-owned boundary to the next older journal window.
     * Business rules:
     * - No cursor is fabricated when the server reports complete history.
     * Execution flow:
     * 1. Return the acknowledged next cursor only when hasMore is true.
     * Failure cases:
     * - Missing continuation leaves history complete or unavailable as reported by the server.
     * Side effects:
     * - None: query pagination metadata only.
     */
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
}
