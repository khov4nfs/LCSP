"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AUTHORED_LOCALIZATION_STATES,
  AUTHORED_LOCALIZATION_FILTERS,
  type AuthoredLocalizationFilter,
  authoredBatchReviewResultSchema,
  authoredLocalizationBacklogResponseSchema,
  authoredLocalizationQueueResponseSchema,
  type AuthoredBatchOutputReview,
  type AuthoredBatchSourceReview,
  type AuthoredCandidateAction,
  type AuthoredLocalizationEntity,
  type authoredOutputReviewSchema,
  type authoredSourceReviewSchema,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated } from "./api-request";

/**
 * Business purpose: Discover operational localization backlog across scopes for Admin review.
 * Business rules:
 * - Only Admin callers can read the backlog; no scopeId is required to discover pending localization work.
 * Execution flow:
 * 1. Register a validated React Query subscription keyed by pagination cursor and entity filter.
 * Failure cases:
 * - Authorization, transport and schema failures remain query errors without fabricated counts.
 * Side effects:
 * - Performs one authenticated BFF read.
 */
export function useLocalizationBacklogQuery(
  afterScopeId?: string,
  entityType?: AuthoredLocalizationEntity,
) {
  const params = new URLSearchParams();
  if (afterScopeId) params.set("afterScopeId", afterScopeId);
  if (entityType) params.set("entityType", entityType);
  const query = params.toString();
  return useQuery({
    queryKey: [
      "admin-localization",
      "backlog",
      afterScopeId ?? "",
      entityType ?? "",
    ],
    /**
     * Business purpose: Load the validated Admin localization backlog page.
     * Business rules:
     * - Validate response against authoredLocalizationBacklogResponseSchema.
     * Execution flow:
     * 1. GET the BFF localization backlog endpoint.
     * Failure cases:
     * - Invalid or unauthorized responses reject the query.
     * Side effects:
     * - Performs one BFF read.
     */
    queryFn: ({ signal }) =>
      apiValidated(
        `/api/admin/localization${query ? `?${query}` : ""}`,
        authoredLocalizationBacklogResponseSchema,
        { signal },
      ),
  });
}

/**
 * Business purpose: Coordinate Admin field-level localization review, bounded batch attestations, candidate rejection and retries for one scope.
 * Business rules:
 * - Scope identity partitions caches; backend Admin authorization, SHA-256 verification and append-only audit remain authoritative.
 * Execution flow:
 * 1. Load the scope queue, register single and batch review mutations, and invalidate scope/backlog caches after acknowledged writes.
 * Failure cases:
 * - Stale hashes, rejected candidates or authorization failures remain explicit query/mutation errors.
 * Side effects:
 * - Performs authenticated BFF reads and review mutations.
 */
export function useLocalizationScopeReview(
  scopeId: string,
  after?: string,
  filter: AuthoredLocalizationFilter = AUTHORED_LOCALIZATION_FILTERS.ALL,
  history = false,
) {
  const client = useQueryClient();
  const root = `/api/admin/localization/${encodeURIComponent(scopeId)}`;
  /**
   * Business purpose: Refresh localization backlog, scope queue and rule-grouping caches after an acknowledged review mutation.
   * Business rules:
   * - Invalidate both admin-localization and admin-rule-grouping prefixes for the scope.
   * Execution flow:
   * 1. Trigger parallel React Query invalidations.
   * Failure cases:
   * - Invalidation errors propagate through React Query.
   * Side effects:
   * - Marks matching queries stale and triggers active refetches.
   */
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["admin-localization"] }),
      client.invalidateQueries({ queryKey: ["admin-rule-grouping", scopeId] }),
    ]);

  const queue = useQuery({
    queryKey: [
      "admin-localization",
      "scope",
      scopeId,
      after ?? "",
      filter,
      history,
    ],
    enabled: Boolean(scopeId),
    /**
     * Business purpose: Read field-level localization requests and candidate/review evidence for the selected scope.
     * Business rules:
     * - Validate the public queue response schema; read never invokes translation providers.
     * Execution flow:
     * 1. GET the scope-specific BFF queue endpoint.
     * Failure cases:
     * - Missing authorization or schema mismatch rejects the query.
     * Side effects:
     * - Performs one BFF read.
     */
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ filter, history: String(history) });
      if (after) params.set("after", after);
      return apiValidated(
        `${root}?${params}`,
        authoredLocalizationQueueResponseSchema,
        { signal },
      );
    },
  });

  const reviewSource = useMutation({
    /**
     * Business purpose: Submit a single field's source-language determination bound to exact SHA-256 and canonicalRevision.
     * Business rules:
     * - Server validates hashes and records authenticated reviewer identity.
     * Execution flow:
     * 1. POST the source-review payload to the request-specific BFF endpoint.
     * Failure cases:
     * - Stale hashes or conflicting provenance reject the mutation.
     * Side effects:
     * - Persists source review evidence and releases eligible work.
     */
    mutationFn: (input: {
      requestId: string;
      body: z.infer<typeof authoredSourceReviewSchema>;
    }) =>
      apiValidated(
        `${root}/${encodeURIComponent(input.requestId)}/source-review`,
        z.object({ reviewed: z.number().int().nonnegative() }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
      ),
    onSuccess: invalidate,
  });

  const reviewOutput = useMutation({
    /**
     * Business purpose: Submit a single field's target-language approval or normalization bound to exact origin and content SHA-256.
     * Business rules:
     * - Server validates hashes and publishes an immutable localized revision.
     * Execution flow:
     * 1. POST the output-review payload to the request-specific BFF endpoint.
     * Failure cases:
     * - Stale hashes or rejected candidates without normalization reject the mutation.
     * Side effects:
     * - Persists output review evidence and READY revision.
     */
    mutationFn: (input: {
      requestId: string;
      body: z.infer<typeof authoredOutputReviewSchema>;
    }) =>
      apiValidated(
        `${root}/${encodeURIComponent(input.requestId)}/output-review`,
        z.object({ state: z.literal(AUTHORED_LOCALIZATION_STATES.READY) }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
      ),
    onSuccess: invalidate,
  });

  const batchSource = useMutation({
    /**
     * Business purpose: Submit bounded batch source-language attestations for up to 50 individually reviewed fields.
     * Business rules:
     * - Requires confirmsIndividualFieldReview=true and returns itemized accepted/rejected outcomes.
     * Execution flow:
     * 1. POST the batch source-review payload to the scope BFF endpoint.
     * Failure cases:
     * - Validation or authorization failures reject the mutation; partial item failures are returned in results.
     * Side effects:
     * - Persists source review evidence for accepted items.
     */
    mutationFn: (body: AuthoredBatchSourceReview) =>
      apiValidated(
        `${root}/batch-source-review`,
        authoredBatchReviewResultSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: invalidate,
  });

  const batchOutput = useMutation({
    /**
     * Business purpose: Submit bounded batch target-language output attestations for up to 50 reviewed fields.
     * Business rules:
     * - Requires confirmsTargetLanguageAndMeaning=true and returns itemized accepted/rejected outcomes.
     * Execution flow:
     * 1. POST the batch output-review payload to the scope BFF endpoint.
     * Failure cases:
     * - Validation or authorization failures reject the mutation; partial item failures are returned in results.
     * Side effects:
     * - Publishes immutable READY revisions for accepted items.
     */
    mutationFn: (body: AuthoredBatchOutputReview) =>
      apiValidated(
        `${root}/batch-output-review`,
        authoredBatchReviewResultSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: invalidate,
  });

  const retryOrReject = useMutation({
    /**
     * Business purpose: Reject an invalid provider candidate or request a controlled retry on a failed/pending localization job.
     * Business rules:
     * - Never mutates canonical bytes or accepted READY revisions.
     * Execution flow:
     * 1. POST the candidate action payload to the request-specific retry BFF endpoint.
     * Failure cases:
     * - Stale hashes or accepted READY revisions reject the mutation.
     * Side effects:
     * - Records immutable review evidence and transitions or supersedes the request.
     */
    mutationFn: (input: { requestId: string; body: AuthoredCandidateAction }) =>
      apiValidated(
        `${root}/${encodeURIComponent(input.requestId)}/retry`,
        z.object({
          id: z.string().min(1),
          state: z.enum(AUTHORED_LOCALIZATION_STATES),
          translationRevision: z.number().int().positive(),
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
      ),
    onSuccess: invalidate,
  });

  return {
    queue,
    reviewSource,
    reviewOutput,
    batchSource,
    batchOutput,
    retryOrReject,
  };
}
