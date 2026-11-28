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
 * Business purpose: Browse complete server-composed Article–Clause–Point provision leaves for one source document.
 * Business rules:
 * - Source version, document, and page partition the cache; the server resolves ancestors from every persisted chunk.
 *
 * Execution flow:
 * 1. Build a bounded query string and validate the returned provision projection.
 * 2. Keep the result under a document-specific query key.
 *
 * Failure cases:
 * - Missing identities disable the request; transport, authorization, and schema errors remain query errors.
 *
 * Side effects:
 * - Performs a read-only API request and subscribes to the query cache.
 */
export function useLegalRuleSourceProvisions(
  sourceVersionId: string,
  documentId: string,
  page: number,
) {
  const params = new URLSearchParams({
    sourceVersionId,
    documentId,
    page: String(page),
    pageSize: String(C.LEGAL_RULE_LIMITS.pageSize),
  });
  return useQuery({
    queryKey: [
      ...legalRuleCatalogKey,
      "source-provisions",
      sourceVersionId,
      documentId,
      page,
    ],
    enabled: Boolean(sourceVersionId && documentId),
    /**
     * Business purpose: Read the selected page of server-composed eligible source leaves.
     * Business rules:
     * - The API owns ancestry, effectiveness, and classification; the browser does not request ancestor chunks itself.
     *
     * Execution flow:
     * 1. Send the pinned source/document/page query through the shared API client.
     * 2. Validate the full response contract before caching it.
     *
     * Failure cases:
     * - Missing documents, ineligible versions, and malformed responses remain query errors.
     *
     * Side effects:
     * - Performs a read-only BFF request and populates the keyed query cache.
     */
    queryFn: () =>
      apiValidated(
        `${root}/source-provisions?${params}`,
        C.legalRuleSourceProvisionPageSchema,
      ),
  });
}

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
 * Business purpose: Read one page of the Admin's catalog search and preparation filters.
 * Business rules:
 * - Browsing and bulk selection use the same authenticated list projection and validated page contract.
 * Execution flow:
 * 1. Serialize the catalog's search, filter, and page parameters.
 * 2. Request and validate the matching page through the shared API client.
 * Failure cases:
 * - Request and schema failures reject the read.
 * Side effects:
 * - Performs a read-only BFF request.
 */
function readLegalRulePage(catalogId: string, query: C.LegalRuleList) {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
    search: query.search,
  });
  if (query.state) params.set("state", query.state);
  if (query.withAssessmentRules) params.set("withAssessmentRules", "true");
  return apiValidated(
    `${root}/${encodeURIComponent(catalogId)}/rules?${params}`,
    C.legalRulePageSchema,
  );
}

/**
 * Business purpose: Browse one server-filtered catalog page while selection remains independent.
 * Business rules:
 * - Catalog, page and filters (including persisted Assessment Rule availability) partition the cache.
 * Execution flow:
 * 1. Register the page query
 * 2. Send bounded normalized query parameters.
 * Failure cases:
 * - Missing catalog disables the request; stale or denied responses remain errors.
 * Side effects:
 * - Read-only API/cache activity.
 */
export function useLegalRules(catalogId: string, query: C.LegalRuleList) {
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
    queryFn: () => readLegalRulePage(catalogId, query),
    refetchInterval: 3000,
  });
}

/**
 * Business purpose: Resolve all current prepared results matching the Admin's search for one activation.
 * Business rules:
 * - Keep every page scoped to the same catalog and revision. Only server-filtered prepared results with exact identities enter the selection.
 * Execution flow:
 * 1. Read the first page with the prepared Assessment Rules filter.
 * 2. Collect the remaining pages using the server total and the same filter.
 * 3. Return the complete selection once each expected result is accounted for.
 * Failure cases:
 * - Failed reads, changed totals or revisions, missing results, and duplicate rows reject the entire selection.
 * Side effects:
 * - Performs read-only catalog requests through a manually triggered mutation. Publication remains a separate confirmed command.
 */
export function useLegalRuleActivationSelection(catalogId: string) {
  return useMutation({
    /**
     * Business purpose: Assemble a complete cross-page activation selection against the displayed catalog revision.
     * Business rules:
     * - Search scope remains fixed across pages. Each row must carry a valid persisted result identity for the later confirmation.
     * Execution flow:
     * 1. Request the full set using bounded pages and check each page against the first page's total and the displayed revision.
     * 2. Accumulate exact result identities and verify that the set contains every matching row once.
     * Failure cases:
     * - An empty, stale, incomplete, or invalid projection rejects the fetch before it can replace the user's selection.
     * Side effects:
     * - Reads filtered catalog pages and returns local selection data.
     */
    mutationFn: async ({
      filters,
      expectedRevision,
    }: {
      filters: C.LegalRuleFilter;
      expectedRevision: number;
    }) => {
      const query = {
        ...filters,
        withAssessmentRules: true,
        page: 1,
        limit: C.LEGAL_RULE_LIMITS.pageSize,
      };
      const first = await readLegalRulePage(catalogId, query);
      const candidates = new Map<string, C.LegalRuleListItem>();
      const resultIds = new Set<string>();
      const pageCount = Math.ceil(first.total / query.limit);
      if (first.total <= 0 || first.total > C.LEGAL_RULE_LIMITS.catalogRules)
        throw new Error(
          "Prepared activation selection is empty or exceeds the catalog limit",
        );

      // Publish the selection only after all pages agree, so a changing catalog cannot leave a partial batch selected.
      for (let page = 1; page <= pageCount; page += 1) {
        const current =
          page === 1
            ? first
            : await readLegalRulePage(catalogId, { ...query, page });
        if (
          current.catalogVersionId !== catalogId ||
          current.catalogRevision !== expectedRevision ||
          current.total !== first.total ||
          current.page !== page ||
          current.limit !== query.limit
        )
          throw new Error("Catalog changed while selecting prepared results");

        for (const rule of current.items) {
          if (
            rule.state !== C.LEGAL_RULE_PREPARATION_STATES.PREPARED ||
            rule.assessmentRuleCount <= 0 ||
            !rule.lastResultId ||
            !rule.lastResultRevision ||
            candidates.has(rule.id) ||
            resultIds.has(rule.lastResultId)
          )
            throw new Error(
              "Activation selection contains an invalid prepared result",
            );
          candidates.set(rule.id, rule);
          resultIds.add(rule.lastResultId);
        }
      }

      if (candidates.size !== first.total)
        throw new Error("Prepared activation selection is incomplete");
      return candidates;
    },
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

/**
 * Business purpose: Activate only the explicitly confirmed prepared Assessment Rules selected by an Admin.
 *
 * Business rules:
 * - The API revalidates each exact result revision; the browser cannot publish or mark rules ACTIVE optimistically.
 * - A successful publication refreshes catalog result views and the shared ACTIVE Rule Set/history reads.
 *
 * Execution flow:
 * 1. POST the selected result identities and idempotency key through the shared API client.
 * 2. Validate the server's activation acknowledgement.
 * 3. Invalidate catalog and ACTIVE Rule Set caches after the server confirms the transaction.
 *
 * Failure cases:
 * - Stale/ineligible selections, authorization errors, network failures, and malformed responses remain mutation errors.
 *
 * Side effects:
 * - One explicit server publication request and cache invalidation; no client-side Rule Set state is written.
 */
export function useLegalRuleActivation(catalogId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Submit the exact Admin-confirmed selected-result manifest for server-side activation.
     * Business rules:
     * - Keep the user's selected result IDs, revisions, expected catalog revision, and idempotency key intact for backend revalidation.
     * Execution flow:
     * 1. POST the manifest to the catalog-scoped activation route through the shared schema-validating API client.
     * Failure cases:
     * - Authorization, stale-result, source-integrity, network, or response-contract failures reject the mutation.
     * Side effects:
     * - Sends one publication command; it does not change client or server lifecycle state itself.
     */
    mutationFn: (input: C.LegalRuleActivationRequest) =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/assessment-rules/activate`,
        C.legalRuleActivationResultSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      ),
    /**
     * Business purpose: Refresh the selected-result catalog and canonical Rule Set views after activation is acknowledged.
     * Business rules:
     * - Cache invalidation occurs only after the backend confirms successful atomic publication.
     * Execution flow:
     * 1. Mark catalog/result and Admin Rule Set queries stale together.
     * Failure cases:
     * - A failed invalidation remains visible to the mutation lifecycle; no success is synthesized.
     * Side effects:
     * - Triggers eligible React Query refetches for current subscribers.
     */
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
        client.invalidateQueries({
          queryKey: ["admin", "compliance-rule-sets"],
        }),
      ]);
    },
  });
}

/**
 * Business purpose: Import one server-validated source leaf into the catalog pinned to its source version.
 * Business rules:
 * - The caller sends only catalog/document/leaf identity and expected revision; the API recomputes composition and citations.
 *
 * Execution flow:
 * 1. POST the bounded identity to the catalog-scoped import route.
 * 2. Validate the saved-rule acknowledgement.
 *
 * Failure cases:
 * - Ineligible leaves, stale catalog revisions, and API/schema failures remain mutation errors.
 *
 * Side effects:
 * - Saves one LegalRule through catalog authority and invalidates catalog reads after success.
 */
export function useImportLegalRuleSourceProvision() {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send one source leaf identity for authoritative LegalRule import.
     * Business rules:
     * - Caller-supplied prose and citation references are excluded; the API recomputes them against the pinned catalog source.
     *
     * Execution flow:
     * 1. Remove the catalog identity from the request body.
     * 2. POST the leaf request and validate the saved-rule response.
     *
     * Failure cases:
     * - Eligibility, revision, authority, or response-contract failures reject the mutation.
     *
     * Side effects:
     * - Requests one LegalRule save through the shared authenticated API client.
     */
    mutationFn: (
      input: C.LegalRuleSourceProvisionImport & { catalogId: string },
    ) => {
      const { catalogId, ...request } = input;
      return apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/source-provisions/import`,
        C.legalRuleSavedSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
    },
    /**
     * Business purpose: Refresh catalog and preparation reads after a successful source import.
     * Business rules:
     * - Cache invalidation occurs only after the API returns a schema-valid acknowledgement.
     *
     * Execution flow:
     * 1. Invalidate the shared LegalRule Catalog query prefix.
     *
     * Failure cases:
     * - Query-client invalidation failures propagate through mutation lifecycle handling.
     *
     * Side effects:
     * - Marks matching query entries stale and refetches active observers.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
  });
}

/**
 * Business purpose: Delete an idle LegalRule catalog and invalidate all catalog queries.
 * Business rules:
 * - Admin authorization required; deletes are immediate upon backend confirmation.
 * Execution flow:
 * 1. Dispatch DELETE request with catalog identity.
 * 2. Validate acknowledgement response.
 * 3. Invalidate catalog query cache.
 * Failure cases:
 * - Rejections (404/409) propagate to mutation state without optimistic removal.
 * Side effects:
 * - Sends DELETE mutation and triggers refetch of active catalog queries.
 */
export function useDeleteLegalRuleCatalog() {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Dispatch deletion of a specific catalog version.
     * Business rules:
     * - Only targeted catalog ID is passed; server verifies eligibility.
     * Execution flow:
     * 1. Send DELETE request to catalog endpoint.
     * Failure cases:
     * - Transport or server rejection throws mutation error.
     * Side effects:
     * - Issues DELETE request to API proxy.
     */
    mutationFn: (catalogId: string) =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}`,
        C.legalRuleCatalogDeleteResponseSchema,
        { method: "DELETE" },
      ),
    /**
     * Business purpose: Evict stale catalog cache after deletion.
     * Business rules:
     * - Only fires on successful deletion.
     * Execution flow:
     * 1. Invalidate all catalog query keys.
     * Failure cases:
     * - Cache invalidation errors propagate.
     * Side effects:
     * - Triggers refetch for active catalog lists.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
  });
}

/**
 * Business purpose: Let an Admin check or import externally authored Assessment Rules into one catalog without running the Preparation agent.
 *
 * Business rules:
 * - A dry run only validates and previews; the API alone decides validity, revision and conflicts, and nothing is recorded until a non-dry-run request is acknowledged.
 * - Only a real import changes what the catalog shows, so only it refreshes cached catalog reads.
 *
 * Execution flow:
 * 1. POST one v1 document to the catalog-scoped import route through the schema-validating client.
 * 2. Validate the acknowledgement.
 * 3. After a real import, invalidate the catalog query prefix.
 *
 * Failure cases:
 * - Stale revision, active run, invalid output, authorization and response-contract failures remain mutation errors.
 *
 * Side effects:
 * - One explicit API request; a real import records prepared result revisions server-side and never activates them.
 */
export function useAssessmentRuleImport(catalogId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send one authored import document for checking or recording.
     * Business rules:
     * - The document is sent exactly as authored apart from the caller's dryRun choice.
     * Execution flow:
     * 1. Serialize and POST the document to the import route.
     * Failure cases:
     * - Any API or contract failure rejects the mutation.
     * Side effects:
     * - One upstream request.
     */
    mutationFn: (request: C.AssessmentRuleImportRequest) =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/assessment-rules/import`,
        C.assessmentRuleImportResultSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      ),
    /**
     * Business purpose: Refresh catalog reads once rules were really imported.
     * Business rules:
     * - A dry run changes nothing and therefore never invalidates caches.
     * Execution flow:
     * 1. Skip dry-run acknowledgements; otherwise invalidate the catalog prefix.
     * Failure cases:
     * - Invalidation failures propagate through the mutation lifecycle.
     * Side effects:
     * - Marks catalog queries stale after a real import.
     */
    onSuccess: (data) =>
      data.dryRun
        ? undefined
        : client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
  });
}

/**
 * Business purpose: Read one persisted semantic scope authorization candidate and its pinned source citations.
 * Business rules:
 * - Catalog and scopeKey partition the query cache; missing/invalid keys disable the request.
 * Execution flow:
 * 1. Fetch the candidate detail via the BFF proxy.
 * 2. Validate against selectedScopeAuthorizationDetailSchema.
 * Failure cases:
 * - Missing or stale candidates reject via shared apiValidated error handling.
 * Side effects:
 * - Read-only query subscription.
 */
/**
 * Business purpose: List semantic review authorizations for a specific Legal Rule so the UI auto-loads candidates without manual scopeKey entry.
 * Business rules:
 * - Catalog and ruleId partition the query cache; missing IDs disable the request.
 * Execution flow:
 * 1. Fetch authorization summaries for (catalogId, ruleId).
 * 2. Validate against selectedScopeAuthorizationListSchema.
 * Failure cases:
 * - Transport or authorization errors reject via shared apiValidated error handling.
 * Side effects:
 * - Read-only query subscription.
 */
export function useRuleScopeAuthorizations(catalogId: string, ruleId: string) {
  return useQuery({
    queryKey: [...legalRuleCatalogKey, "rule-scope-authorizations", catalogId, ruleId],
    enabled: Boolean(catalogId && ruleId),
    /**
     * Business purpose: Fetch authorization summaries for the selected Legal Rule.
     * Business rules:
     * - Scoped to catalogId and ruleId.
     * Execution flow:
     * 1. GET from BFF proxy.
     * 2. Validate response schema.
     * Failure cases:
     * - Errors propagate as query errors.
     * Side effects:
     * - Read-only BFF GET request.
     */
    queryFn: () =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/rules/${encodeURIComponent(ruleId)}/scope-authorizations`,
        C.selectedScopeAuthorizationListSchema,
      ),
  });
}

/**
 * Business purpose: Load one persisted semantic scope authorization detail for independent Admin review.
 * Business rules:
 * - Catalog and scopeKey partition the query cache; missing/invalid keys disable the request.
 * Execution flow:
 * 1. Fetch the candidate detail via the BFF proxy.
 * 2. Validate against selectedScopeAuthorizationDetailSchema.
 * Failure cases:
 * - Missing or stale candidates reject via shared apiValidated error handling.
 * Side effects:
 * - Read-only query subscription.
 */
export function useScopeAuthorization(catalogId: string, scopeKey: string) {
  return useQuery({
    queryKey: [...legalRuleCatalogKey, "scope-authorizations", catalogId, scopeKey],
    enabled: Boolean(catalogId && /^[a-f0-9]{64}$/.test(scopeKey)),
    /**
     * Business purpose: Fetch one persisted scope authorization candidate from the Admin BFF.
     * Business rules:
     * - Only valid 64-hex scope keys under the owning catalog are requested.
     * Execution flow: 1. Request candidate detail. 2. Validate against selectedScopeAuthorizationDetailSchema.
     * Failure cases:
     * - Missing, stale, or unauthorized candidates reject as query errors.
     * Side effects:
     * - Performs a read-only BFF GET request.
     */
    queryFn: () =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/scope-authorizations/${encodeURIComponent(scopeKey)}`,
        C.selectedScopeAuthorizationDetailSchema,
      ),
  });
}

/**
 * Business purpose: Submit or revise a semantic scope authorization candidate for independent review.
 * Business rules:
 * - Invalidates cached scope-authorization and catalog queries on success.
 * Execution flow:
 * 1. POST submit payload to the catalog-scoped BFF route.
 * 2. Validate the summary response and refresh caches.
 * Failure cases:
 * - Stale revisions or invalid source support reject with typed API problems.
 * Side effects:
 * - Persists a DRAFT authorization candidate on the server.
 */
export function useSubmitScopeAuthorization(catalogId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Submit a semantic scope authorization draft for independent review.
     * Business rules:
     * - The server validates source support and prevents overwriting approved rows.
     * Execution flow: 1. POST the candidate payload. 2. Validate the returned summary.
     * Failure cases:
     * - Stale revisions or invalid source spans reject with API problem codes.
     * Side effects:
     * - Persists a DRAFT authorization candidate on the backend.
     */
    mutationFn: (request: C.SelectedScopeAuthorizationSubmit) =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/scope-authorizations/submit`,
        C.selectedScopeAuthorizationSummarySchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      ),
    /**
     * Business purpose: Refresh catalog and scope-authorization caches after draft submission.
     * Business rules:
     * - Only committed submissions trigger cache invalidation.
     * Execution flow: 1. Invalidate the legalRuleCatalogKey prefix.
     * Failure cases:
     * - Cache invalidation errors propagate through React Query.
     * Side effects:
     * - Marks cached catalog queries stale.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
  });
}

/**
 * Business purpose: Independently approve a reviewed semantic scope authorization candidate.
 * Business rules:
 * - Requires an independent reviewer and explicit legal confirmation.
 * Execution flow:
 * 1. POST approval payload to the catalog-scoped BFF route.
 * 2. Validate the summary response and refresh caches.
 * Failure cases:
 * - Self-approval, stale revision, or source drift reject with typed API problems.
 * Side effects:
 * - Transitions the candidate to APPROVED on the server.
 */
export function useApproveScopeAuthorization(catalogId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send an independent reviewer's approval for a DRAFT scope authorization.
     * Business rules:
     * - Reviewer must differ from author and confirm legal review.
     * Execution flow: 1. POST the approval payload. 2. Validate the returned summary.
     * Failure cases:
     * - Self-approval or stale revisions reject with API problem codes.
     * Side effects:
     * - Transitions the authorization to APPROVED on the backend.
     */
    mutationFn: (request: C.SelectedScopeAuthorizationApprove) =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/scope-authorizations/approve`,
        C.selectedScopeAuthorizationSummarySchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      ),
    /**
     * Business purpose: Refresh catalog and scope-authorization caches after approval.
     * Business rules:
     * - Only committed approvals trigger cache invalidation.
     * Execution flow: 1. Invalidate the legalRuleCatalogKey prefix.
     * Failure cases:
     * - Cache invalidation errors propagate through React Query.
     * Side effects:
     * - Marks cached catalog queries stale.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
  });
}

/**
 * Business purpose: Revoke a previously approved semantic scope authorization so it cannot authorize new publications.
 * Business rules:
 * - Requires explicit revocation confirmation and a non-blank reason.
 * Execution flow:
 * 1. POST revocation payload to the catalog-scoped BFF route.
 * 2. Validate the summary response and refresh caches.
 * Failure cases:
 * - Stale revisions or non-APPROVED rows reject with CONFLICT.
 * Side effects:
 * - Transitions the authorization to REJECTED while preserving historical records.
 */
export function useRevokeScopeAuthorization(catalogId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Revoke an APPROVED scope authorization to block future reuse.
     * Business rules:
     * - Requires explicit confirmation and a non-blank revocation reason.
     * Execution flow: 1. POST the revocation payload. 2. Validate the returned summary.
     * Failure cases:
     * - Stale revisions or non-APPROVED rows reject with CONFLICT.
     * Side effects:
     * - Transitions the authorization to REJECTED while preserving history.
     */
    mutationFn: (request: C.SelectedScopeAuthorizationRevoke) =>
      apiValidated(
        `${root}/${encodeURIComponent(catalogId)}/scope-authorizations/revoke`,
        C.selectedScopeAuthorizationSummarySchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      ),
    /**
     * Business purpose: Refresh catalog and scope-authorization caches after revocation.
     * Business rules:
     * - Only committed revocations trigger cache invalidation.
     * Execution flow: 1. Invalidate the legalRuleCatalogKey prefix.
     * Failure cases:
     * - Cache invalidation errors propagate through React Query.
     * Side effects:
     * - Marks cached catalog queries stale.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: legalRuleCatalogKey }),
  });
}
