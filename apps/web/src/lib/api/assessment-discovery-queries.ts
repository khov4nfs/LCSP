"use client";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ASSESSMENT_DISCOVERY_RUN_STATUSES,
  DISCOVERY_DETAIL_COLLECTIONS,
  repositoryDiscoveryDetailPageSchema,
  assessmentDiscoveryBatchViewSchema,
  assessmentDiscoveryLatestRunSchema,
} from "@lcsp/contracts/assessment-domain";

import { apiValidated } from "./api-request";

/**
 * Business purpose: Recognize a repository scan that has not settled yet.
 * Business rules:
 * - Only queued and running runs are active; completed and failed runs are terminal.
 * Execution flow:
 * 1. Compare the run status with the active statuses.
 * Failure cases:
 * - None; pure predicate.
 * Side effects:
 * - None; pure calculation.
 */
function isActiveRun(run: { status: string }): boolean {
  return (
    run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.queued ||
    run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.running
  );
}

export const assessmentDiscoveryKeys = {
  /**
   * Business purpose: Address one assessment's latest persisted discovery independently of audit progress.
   * Business rules:
   * - Assessment identity partitions the query cache and cannot grant API ownership.
   * Execution flow:
   * 1. Return a stable scope-specific query key.
   * Failure cases:
   * - The caller disables reads when assessment identity is missing.
   * Side effects:
   * - Pure cache-key calculation.
   */
  latest: (id: string) => ["assessment", id, "discovery", "latest"] as const,
};

/**
 * Business purpose: Restore the owner-visible pre-audit Discovery run and poll only while it is active.
 * Business rules:
 * - The API's exact pin-bound run state and discovery digest remain authoritative.
 * - An absent run is not evidence of absence of AI; polling stops at terminal state.
 * Execution flow:
 * 1. Read the latest owner-scoped run and validate the response contract.
 * 2. Poll queued/running status until a terminal outcome or user leaves.
 * Failure cases:
 * - Network or contract failure is an explicit query error, not a fabricated empty result.
 * Side effects:
 * - Read-only owner-authenticated requests and query cache updates.
 */
export function useAssessmentDiscoveryLatestQuery(id: string) {
  return useQuery({
    queryKey: assessmentDiscoveryKeys.latest(id),
    enabled: Boolean(id),
    /**
     * Business purpose: Retrieve the owner's latest durable discovery status.
     * Business rules:
     * - The server validates ownership, pins and the complete response contract.
     * Execution flow:
     * 1. Fetch the owner-scoped latest discovery with cancellation support.
     * Failure cases:
     * - Upstream or schema errors reject rather than producing an empty fake run.
     * Side effects:
     * - Performs one authenticated HTTP GET request.
     */
    queryFn: ({ signal }) =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/discovery-runs/latest`,
        assessmentDiscoveryLatestRunSchema,
        { signal },
      ),
    /**
     * Business purpose: Keep the discovery progress fresh only while scanning is active.
     * Business rules:
     * - Terminal and missing statuses disable polling; a status is not a legal outcome.
     * Execution flow:
     * 1. Read canonical cached status and choose the active-only refresh interval.
     * Failure cases:
     * - Missing query data disables polling safely.
     * Side effects:
     * - Pure scheduling decision for TanStack Query.
     */
    refetchInterval: (query) => {
      const view = query.state.data;
      // A batch keeps polling until every repository's scan has settled.
      return view?.available && view.runs.some(isActiveRun) ? 3_000 : false;
    },
  });
}

/**
 * Business purpose: Start an explicitly user-requested Discovery without granting audit scope.
 * Business rules:
 * - Caller supplies a stable UUID per retry; the API controls owner, snapshot and concurrency.
 * Execution flow:
 * 1. POST one idempotent discovery command; the API scans every pinned repository.
 * 2. Make the persisted new batch (one run per repository) visible in the same assessment cache.
 * Failure cases:
 * - Failed command leaves prior results intact and preserves retry identity at the caller.
 * Side effects:
 * - May enqueue one API-owned scanner run and invalidate its cached projection.
 */
export function useStartAssessmentDiscovery(id: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send a customer-authorized deterministic scan request without selecting rules.
     * Business rules:
     * - Stable idempotency key is forwarded exactly; API owns source scope and lease.
     * Execution flow:
     * 1. POST a validated run request to the owner-scoped BFF.
     * Failure cases:
     * - API or validation errors reject without changing existing results.
     * Side effects:
     * - May enqueue one durable scanner run in the server.
     */
    mutationFn: (idempotencyKey: string) =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/discovery-runs`,
        assessmentDiscoveryBatchViewSchema,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey }),
        },
      ),
    /**
     * Business purpose: Replace the latest discovery cache with a server-issued run after acceptance.
     * Business rules:
     * - Only authoritative mutation success updates the visible run identity.
     * Execution flow:
     * 1. Store the accepted run and invalidate its latest-status query for refresh.
     * Failure cases:
     * - Failed refetch remains a query error rather than a fabricated outcome.
     * Side effects:
     * - Mutates the local query cache; no additional audit request is created.
     */
    onSuccess: async (batch) => {
      client.setQueryData(assessmentDiscoveryKeys.latest(id), {
        available: true,
        run: batch.run,
        runs: batch.runs,
      });
      await client.invalidateQueries({
        queryKey: assessmentDiscoveryKeys.latest(id),
      });
    },
  });
}
/**
 * Business purpose: Browse the pinned recommendation inventory without downloading thousands of candidates on page load.
 * Business rules:
 * - Pages are requested only on demand and must all share the exact immutable content digest.
 * - An unreturned page is unknown, not evidence that a rule is inapplicable.
 * Execution flow:
 * 1. Request the first bounded page of one completed owner's Discovery run.
 * 2. On explicit "load more", follow the server cursor after verifying digest, count and offset.
 * Failure cases:
 * - Missing/changed immutable records, invalid cursors, or partial pages fail explicitly.
 * Side effects:
 * - Read-only owner requests and bounded client query cache.
 */
export function useAssessmentDiscoveryCandidatesQuery(
  assessmentId: string,
  runId: string | null,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["assessment", assessmentId, "discovery", "candidates", runId],
    enabled: Boolean(assessmentId && runId && enabled),
    initialPageParam: 0,
    /**
     * Business purpose: Read one bounded page of investigation candidates on customer demand.
     * Business rules:
     * - Each request remains pinned to the exact discovery run and collection.
     * Execution flow:
     * 1. Load the requested offset and validate bounds and continuation cursor.
     * Failure cases:
     * - Invalid collection, cursor, or oversized page rejects before caching.
     * Side effects:
     * - Performs one authenticated, cancellable GET request.
     */
    queryFn: async ({ pageParam, signal }) => {
      const page = await apiValidated(
        `/api/assessments/${encodeURIComponent(assessmentId)}/discovery-runs/${encodeURIComponent(runId!)}/details?collection=${DISCOVERY_DETAIL_COLLECTIONS.ruleCandidates}&offset=${pageParam}&limit=100`,
        repositoryDiscoveryDetailPageSchema,
        { signal },
      );
      if (
        page.collection !== DISCOVERY_DETAIL_COLLECTIONS.ruleCandidates ||
        page.offset !== pageParam ||
        page.items.length > 100 ||
        (page.nextOffset !== null && page.nextOffset <= page.offset)
      ) {
        throw new Error("Invalid discovery candidate page");
      }
      return page;
    },
    /**
     * Business purpose: Continue paging only when the previously fetched candidate inventory is consistent.
     * Business rules:
     * - All pages must share the same immutable content digest and total.
     * Execution flow:
     * 1. Check identity and count, then return the next explicit server offset.
     * Failure cases:
     * - Digest/count mismatch rejects instead of silently hiding recommendations.
     * Side effects:
     * - Pure pagination decision; no external request or legal determination.
     */
    getNextPageParam: (lastPage, allPages) => {
      if (
        lastPage.contentDigest !== allPages[0]?.contentDigest ||
        lastPage.total !== allPages[0]?.total ||
        allPages.reduce((sum, page) => sum + page.items.length, 0) >
          lastPage.total
      ) {
        throw new Error("Discovery candidate inventory changed during paging");
      }
      return lastPage.nextOffset ?? undefined;
    },
  });
}

/**
 * Business purpose: Expose every AI use case's unanswered operational questions through bounded pages before audit selection.
 * Business rules:
 * - The exact completed discovery run and immutable digest authorize advisory questions, not accepted human facts.
 * - No truncated preview may be presented as the complete question inventory.
 * Execution flow:
 * 1. Read a bounded page of AI use cases from the owner's verified discovery.
 * 2. Validate its collection, offset, and continuation metadata.
 * 3. Request additional pages only when the customer explicitly expands the inventory.
 * Failure cases:
 * - Invalid or changed paging identities fail closed and surface a query error rather than hiding questions.
 * Side effects:
 * - Performs owner-authorized read-only HTTP requests and stores bounded TanStack query pages.
 */
export function useAssessmentDiscoveryUseCasesQuery(
  assessmentId: string,
  runId: string | null,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["assessment", assessmentId, "discovery", "use-cases", runId],
    enabled: Boolean(assessmentId && runId && enabled),
    initialPageParam: 0,
    /**
     * Business purpose: Fetch the next page of source-supported AI use cases and their unresolved questions.
     * Business rules:
     * - Collection and page coordinates must match the caller's immutable request.
     * Execution flow:
     * 1. Load a page from the owner-only discovery endpoint and validate pagination metadata.
     * Failure cases:
     * - Unexpected collection, cursor or oversized page raises an explicit error.
     * Side effects:
     * - Performs a cancellable authenticated GET.
     */
    queryFn: async ({ pageParam, signal }) => {
      const page = await apiValidated(
        `/api/assessments/${encodeURIComponent(assessmentId)}/discovery-runs/${encodeURIComponent(runId!)}/details?collection=${DISCOVERY_DETAIL_COLLECTIONS.aiUseCases}&offset=${pageParam}&limit=100`,
        repositoryDiscoveryDetailPageSchema,
        { signal },
      );
      if (
        page.collection !== DISCOVERY_DETAIL_COLLECTIONS.aiUseCases ||
        page.offset !== pageParam ||
        page.items.length > 100 ||
        (page.nextOffset !== null && page.nextOffset <= page.offset)
      ) {
        throw new Error("Invalid discovery use-case page");
      }
      return page;
    },
    /**
     * Business purpose: Continue the complete question inventory without changing the verified discovery snapshot.
     * Business rules:
     * - Every page must use the same content digest and total; missing pages never imply absence of questions.
     * Execution flow:
     * 1. Validate stable digest, total count and returned item bounds.
     * 2. Use the server continuation offset or terminate paging.
     * Failure cases:
     * - Inconsistent immutable inventory raises instead of silently dropping questions.
     * Side effects:
     * - Pure pagination decision.
     */
    getNextPageParam: (lastPage, allPages) => {
      if (
        lastPage.contentDigest !== allPages[0]?.contentDigest ||
        lastPage.total !== allPages[0]?.total ||
        allPages.reduce((sum, page) => sum + page.items.length, 0) >
          lastPage.total
      ) {
        throw new Error("Discovery use-case inventory changed during paging");
      }
      return lastPage.nextOffset ?? undefined;
    },
  });
}
