"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  discoveryInterviewPageSchema,
  discoveryInterviewProposalSchema,
  type ReviewDiscoveryInterviewAnswer,
  type SubmitDiscoveryInterviewAnswer,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated } from "./api-request";
import { assessmentDiscoveryKeys } from "./assessment-discovery-queries";

export const discoveryInterviewKeys = {
  /**
   * Business purpose: Partition the pre-scope context review ledger by assessment and exact discovery run.
   * Business rules:
   * - Local cache identifiers never authorize API access or human fact acceptance.
   * Execution flow:
   * 1. Return a stable scoped query key.
   * Failure cases:
   * - The caller disables reads until run identity is available.
   * Side effects:
   * - Pure cache-key derivation.
   */
  page: (assessmentId: string, runId: string | null) =>
    ["assessment", assessmentId, "discovery", "interview", runId] as const,
};

/**
 * Business purpose: Show the owner's complete proposal/review ledger with bounded authenticated pages.
 * Business rules:
 * - A missing page cannot imply the absence of a pending, accepted or rejected answer.
 * - Every page belongs to one run and must use the same case revision and total.
 * Execution flow:
 * 1. Fetch the first page for the current run and continue only on the server-issued offset.
 * 2. Reject conflicting pagination/revision metadata before showing a complete inventory.
 * Failure cases:
 * - API failures, stale revisions and invalid pages are explicit query errors.
 * Side effects:
 * - Read-only owner HTTP requests and TanStack Query caching.
 */
export function useDiscoveryInterviewPageQuery(
  assessmentId: string,
  runId: string | null,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: discoveryInterviewKeys.page(assessmentId, runId),
    enabled: Boolean(enabled && assessmentId && runId),
    initialPageParam: 0,
    /**
     * Business purpose: Fetch one owner-authorized interview page.
     * Business rules:
     * - Offset and run identity are bounded to the exact requested page.
     * Execution flow:
     * 1. Issue a cancellable request and validate the canonical response contract.
     * Failure cases:
     * - Unexpected offset or more than 100 entries rejects.
     * Side effects:
     * - One read-only HTTP request.
     */
    queryFn: async ({ pageParam, signal }) => {
      const page = await apiValidated(
        `/api/assessments/${encodeURIComponent(assessmentId)}/discovery-runs/${encodeURIComponent(runId!)}/context-answers?offset=${pageParam}&limit=50`,
        discoveryInterviewPageSchema,
        { signal },
      );
      if (page.offset !== pageParam || page.items.length > 50) {
        throw new Error("Invalid Discovery interview page");
      }
      return page;
    },
    /**
     * Business purpose: Continue review history only when its result snapshot has not shifted during pagination.
     * Business rules:
     * - Case revision and total must remain consistent across pages.
     * Execution flow:
     * 1. Validate every page against the first page and advance the authoritative offset.
     * Failure cases:
     * - Concurrent answer/review changes reject rather than hiding pending proposals.
     * Side effects:
     * - Pure pagination calculation.
     */
    getNextPageParam: (lastPage, pages) => {
      const first = pages[0];
      if (
        !first ||
        lastPage.caseRevision !== first.caseRevision ||
        lastPage.total !== first.total ||
        pages.reduce((n, page) => n + page.items.length, 0) > first.total
      ) {
        throw new Error(
          "Discovery interview review history changed during pagination",
        );
      }
      return lastPage.nextOffset ?? undefined;
    },
  });
}

/**
 * Business purpose: Submit a raw operational answer for explicit review without accepting it as fact.
 * Business rules:
 * - The API must verify the question's exact immutable Discovery origin and canonical FactNeed identity.
 * Execution flow:
 * 1. POST a stable-idempotency submission under the customer session.
 * 2. Refresh the owner review ledger after confirmed persistence.
 * Failure cases:
 * - Unauthorized, invalid or conflicting submissions do not update the local success state.
 * Side effects:
 * - May append one pending proposal and invalidates the review cache.
 */
export function useSubmitDiscoveryInterviewAnswer(
  assessmentId: string,
  runId: string,
) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send a user-authored answer without automatic legal or fact authority.
     * Business rules:
     * - Exactly the API-defined question/use-case/answer/UUID fields are submitted.
     * Execution flow:
     * 1. Validate the returned pending proposal.
     * Failure cases:
     * - A failed request preserves the server's existing source state.
     * Side effects:
     * - Authenticated POST request.
     */
    mutationFn: (answer: SubmitDiscoveryInterviewAnswer) =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(assessmentId)}/discovery-runs/${encodeURIComponent(runId)}/context-answers`,
        discoveryInterviewProposalSchema,
        { method: "POST", body: JSON.stringify(answer) },
      ),
    /**
     * Business purpose: Show only the API-confirmed proposal rather than a stale cached interview page.
     * Business rules:
     * - A pending proposal remains non-authoritative; no accepted fact is inferred from a successful submission.
     * Execution flow:
     * 1. Invalidate the exact owner/run review ledger after the server persists the proposal.
     * Failure cases:
     * - Invalidating cache does not alter the server's durable response; query errors remain explicit.
     * Side effects:
     * - Invalidates one client-side query key and schedules a fresh owner read.
     */
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: discoveryInterviewKeys.page(assessmentId, runId),
      });
    },
  });
}

/**
 * Business purpose: Let the owner explicitly confirm or reject a pending Discovery operational fact.
 * Business rules:
 * - API case revisions, ambiguity guards, source evidence and FactNeed status remain authoritative.
 * Execution flow:
 * 1. Submit the exact proposal ID and review action with expected revision.
 * 2. Refresh interview history and newly fact-enriched Discovery recommendations.
 * Failure cases:
 * - Stale or ambiguous proposals surface server error without optimistic fact acceptance.
 * Side effects:
 * - May accept a fact, reject a proposal and invalidate related owner queries.
 */
export function useReviewDiscoveryInterviewAnswer(
  assessmentId: string,
  runId: string,
) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Submit an explicit owner review decision and expected case revision.
     * Business rules:
     * - Neither ACCEPT nor REJECT is inferred from merely submitting a question answer.
     * Execution flow:
     * 1. POST one canonical review request.
     * Failure cases:
     * - Source/lease/revision/ambiguity mismatches reject at the API.
     * Side effects:
     * - Authenticated POST request.
     */
    mutationFn: ({
      proposalId,
      review,
    }: {
      proposalId: string;
      review: ReviewDiscoveryInterviewAnswer;
    }) =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(assessmentId)}/discovery-runs/${encodeURIComponent(runId)}/context-answers/${encodeURIComponent(proposalId)}/review`,
        discoveryInterviewProposalSchema,
        { method: "POST", body: JSON.stringify(review) },
      ),
    /**
     * Business purpose: Refresh the customer's accepted fact and derived candidate views after a reviewed answer.
     * Business rules:
     * - Only a server-accepted review triggers cache invalidation; candidate relevance is not a legal verdict.
     * Execution flow:
     * 1. Invalidate interview history, latest immutable Discovery revision and its paged candidate/use-case inventories.
     * Failure cases:
     * - A later refetch failure leaves the server as authoritative and surfaces a query error.
     * Side effects:
     * - Invalidates bounded TanStack Query caches; creates no additional audit or evidence write.
     */
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: discoveryInterviewKeys.page(assessmentId, runId),
        }),
        client.invalidateQueries({
          queryKey: assessmentDiscoveryKeys.latest(assessmentId),
        }),
        client.invalidateQueries({
          queryKey: [
            "assessment",
            assessmentId,
            "discovery",
            "candidates",
            runId,
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            "assessment",
            assessmentId,
            "discovery",
            "use-cases",
            runId,
          ],
        }),
      ]);
    },
  });
}
