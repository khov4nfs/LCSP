"use client";
import { getAppLocaleSnapshot, subscribeToAppLocale } from "../locale";
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_EVENTS_PAGE_LIMIT,
  assessmentDetailSchema,
  assessmentEventsPageSchema,
  assessmentHumanRequestsResultSchema,
  assessmentProvenanceArtifactSchema,
  assessmentRepositorySetupSchema,
  reconcileOrphanedAssessmentResultSchema,
  answerAssessmentHumanRequestSchema,
  answerAssessmentHumanRequestResultSchema,
  type AnswerAssessmentHumanRequest,
} from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";
import type { AssessmentEvent } from "@lcsp/contracts/assessment";
import { apiValidated } from "./api-request";

export const assessmentDomainKeys = {
  detail: (id: string) => ["assessment", id, "detail"] as const,
  requests: (id: string) => ["assessment", id, "human-requests"] as const,
  setup: (id: string) => ["assessment", id, "repository-setup"] as const,
  events: (id: string) => ["assessment", id, "events"] as const,
  provenance: (id: string) => ["assessment", id, "provenance"] as const,
};
/**
 * Business purpose: Read Assessment detail in the actively selected presentation language.
 * Business rules:
 * - Keep assessment-prefix invalidation and isolate locale caches without cross-language placeholder data.
 * Execution flow:
 * 1. Subscribe to locale changes, fetch with the captured locale and discard superseded requests.
 * Failure cases:
 * - Invalid responses, localization problems and locale changes reject without narrative fallback.
 * Side effects:
 * - Performs an owner-authorized BFF read and updates only the captured locale's cache.
 */
export function useAssessmentDetailQuery(id: string) {
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  return useQuery({
    queryKey: [...assessmentDomainKeys.detail(id), locale],
    /**
     * Business purpose: Retrieve the locale-bound detail projection without stale-language cache writes.
     * Business rules:
     * - The captured locale must remain current before and after the request.
     * Execution flow:
     * 1. Send the locale header and cancellation signal, validate the response, then recheck locale.
     * Failure cases:
     * - Cancellation, locale changes and API validation failures reject the query.
     * Side effects:
     * - Executes one BFF GET with the authenticated browser session.
     */
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      if (getAppLocaleSnapshot() !== locale)
        throw new Error("Assessment locale changed before request");
      const result = await apiValidated(
        `/api/assessments/${encodeURIComponent(id)}`,
        assessmentDetailSchema,
        { signal, headers: { "x-lcsp-locale": locale } },
      );
      if (getAppLocaleSnapshot() !== locale)
        throw new Error("Assessment locale changed during request");
      return result;
    },
    placeholderData: undefined,
    enabled: Boolean(id),
  });
}

/**
 * Business purpose: Coordinate owner-requested cancellation recovery for never-started
 *   orphaned Assessment setup.
 *
 * Business rules:
 * - The backend owns orphan eligibility; refresh detail, events and human requests only after
 *   acknowledged reconciliation.
 *
 * Execution flow:
 * 1. Register the reconciliation mutation and successful-cache invalidation.
 *
 * Failure cases:
 * - Rejected requests remain mutation errors and do not fabricate a cancelled Assessment.
 *
 * Side effects:
 * - Registers a mutation with post-success refetch behavior.
 */
export function useReconcileOrphanedAssessment(id: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Send the owner’s scoped Assessment reconciliation request.
     *
     * Business rules:
     * - Encode the Assessment ID and require reconcileOrphanedAssessmentResultSchema.
     *
     * Execution flow:
     * 1. POST the canonical reconcile-orphaned BFF request.
     *
     * Failure cases:
     * - The shared client rejects ownership/state conflicts, invalid responses and network
     *   failures.
     *
     * Side effects:
     * - One upstream reconciliation command; the server owns any cancellation.
     */
    mutationFn: () =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/reconcile-orphaned`,
        reconcileOrphanedAssessmentResultSchema,
        { method: "POST" },
      ),
    /**
     * Business purpose: Refresh the Assessment projections affected by acknowledged
     *   reconciliation.
     *
     * Business rules:
     * - Invalidate this Assessment’s detail, event and human-request keys together.
     *
     * Execution flow:
     * 1. Await the three cache invalidations in parallel.
     *
     * Failure cases:
     * - Invalidation failures propagate; no local lifecycle result is invented.
     *
     * Side effects:
     * - Marks those query projections stale and refetches active subscriptions.
     */
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: assessmentDomainKeys.detail(id) }),
        client.invalidateQueries({ queryKey: assessmentDomainKeys.events(id) }),
        client.invalidateQueries({
          queryKey: assessmentDomainKeys.requests(id),
        }),
      ]);
    },
  });
}
/**
 * Business purpose: Read open and resolved HITL human-resolution requests in the active presentation language.
 * Business rules:
 * - Partition the query cache by locale while preserving assessmentDomainKeys.requests(id) prefix invalidation.
 * - Reject stale responses if the user switches locale while a request is in flight.
 * Execution flow:
 * 1. Subscribe to the active app locale, send x-lcsp-locale and AbortSignal, and validate the response.
 * Failure cases:
 * - Cancellation, locale changes and localization readiness conflicts reject without cross-language fallback.
 * Side effects:
 * - Performs an owner-authorized BFF read and updates only the captured locale's cache.
 */
export function useHumanRequestsQuery(id: string) {
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  return useQuery({
    queryKey: [...assessmentDomainKeys.requests(id), locale],
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      if (getAppLocaleSnapshot() !== locale)
        throw new Error("Assessment locale changed before request");
      const result = await apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/human-requests`,
        assessmentHumanRequestsResultSchema,
        { signal, headers: { "x-lcsp-locale": locale } },
      );
      if (getAppLocaleSnapshot() !== locale)
        throw new Error("Assessment locale changed during request");
      return result;
    },
    placeholderData: undefined,
    enabled: Boolean(id),
  });
}
/** Hard stop for a runaway read; a real assessment is a few hundred events. */
const MAX_EVENT_PAGES = 40;

/**
 * Business purpose: Load the conversation's deterministic locale-bound event history.
 * Business rules:
 * - Locale partitions cached history so incremental replay cannot reuse another language's narratives.
 * - Canonical sequence deduplicates events; authorization and translation readiness stay server-owned.
 * Execution flow:
 * 1. Read the active locale cache, follow bounded sequence pages and merge each returned event by sequence.
 * Failure cases:
 * - Missing/failed translations and invalid API responses reject the query without canonical fallback.
 * Side effects:
 * - Fetches owner-scoped event pages and populates only the requested locale's query cache.
 */
export function useAssessmentEventsQuery(id: string) {
  const client = useQueryClient();
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  const key = [...assessmentDomainKeys.events(id), locale];
  return useQuery({
    queryKey: key,
    enabled: Boolean(id),
    /**
     * Business purpose: Replay the locale-bound persisted event sequence.
     * Business rules:
     * - Preserve sequence deduplication and reject pages retrieved under a superseded locale.
     * Execution flow:
     * 1. Follow bounded pages using the captured locale and cancellation signal, then merge by sequence.
     * Failure cases:
     * - Cancellation, locale changes and unavailable localization reject without alternate-language fallback.
     * Side effects:
     * - Reads authorized BFF event pages without modifying canonical events.
     */
    queryFn: async ({ signal }) => {
      const known = client.getQueryData<AssessmentEvent[]>(key) ?? [];
      const bySequence = new Map(known.map((event) => [event.sequence, event]));
      let after = known.at(-1)?.sequence ?? 0;
      for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
        signal.throwIfAborted();
        if (getAppLocaleSnapshot() !== locale)
          throw new Error("Assessment locale changed before request");
        const result = await apiValidated(
          `/api/assessments/${encodeURIComponent(id)}/events?afterSequence=${after}&limit=${ASSESSMENT_EVENTS_PAGE_LIMIT}`,
          assessmentEventsPageSchema,
          { signal, headers: { "x-lcsp-locale": locale } },
        );
        if (getAppLocaleSnapshot() !== locale)
          throw new Error("Assessment locale changed during request");
        for (const event of result.events)
          bySequence.set(event.sequence, event);
        if (!result.hasMore || result.nextAfterSequence === null) break;
        after = result.nextAfterSequence;
      }
      return [...bySequence.values()].sort(
        (left, right) => left.sequence - right.sequence,
      );
    },
  });
}
export function useRepositorySetupQuery(id: string) {
  return useQuery({
    queryKey: assessmentDomainKeys.setup(id),
    queryFn: () =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/repository-setup`,
        assessmentRepositorySetupSchema,
      ),
    enabled: Boolean(id),
  });
}
export function useAnswerHumanRequestMutation(id: string, requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (answer: AnswerAssessmentHumanRequest) =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/human-requests/${encodeURIComponent(requestId)}/answers`,
        answerAssessmentHumanRequestResultSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            answerAssessmentHumanRequestSchema.parse(answer),
          ),
        },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["assessment", id] }),
  });
}

export function useAnswerAnyHumanRequestMutation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      answer,
    }: {
      requestId: string;
      answer: AnswerAssessmentHumanRequest;
    }) =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/human-requests/${encodeURIComponent(requestId)}/answers`,
        answerAssessmentHumanRequestResultSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            answerAssessmentHumanRequestSchema.parse(answer),
          ),
        },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["assessment", id] }),
  });
}

/**
 * Business purpose: Load an assessment's stored final-report artifact for the authorized report view.
 *
 * Business rules:
 * - Key the cached result by assessment and artifact identity and validate the response against the versioned immutable report contract.
 * - Do not request until both the assessment ID and artifact ID are available.
 *
 * Execution flow:
 * 1. Construct a stable report query key.
 * 2. Request the selected artifact through the shared API client.
 * 3. Enable the query only when both identities are present.
 *
 * Failure cases:
 * - Upstream API errors and invalid envelopes are surfaced by apiValidated; unavailable IDs keep the query disabled.
 *
 * Side effects:
 * - Performs a read-only API request and updates the query cache.
 */
export function useAssessmentReportQuery(
  id: string,
  artifactId: string | null,
) {
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  return useQuery({
    queryKey: ["assessment", id, "report", artifactId, locale] as const,
    placeholderData: undefined,
    /**
     * Business purpose: Retrieve only the report artifact identified by the active assessment view.
     *
     * Business rules:
     * - Encode route identifiers and require the shared client to validate the immutable, versioned artifact contract.
     *
     * Execution flow:
     * 1. Build the report download API path from the assessment and artifact IDs.
     * 2. Parse the success envelope with the report artifact schema.
     *
     * Failure cases:
     * - Invalid responses and API problems reject the query and are handled by the report view's query state.
     *
     * Side effects:
     * - Performs a read-only API request; no report data is modified.
     */
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      if (getAppLocaleSnapshot() !== locale)
        throw new Error("Assessment locale changed before request");
      const result = await apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId ?? "")}/report`,
        assessmentFinalReportArtifactVersionedSchema,
        { signal, headers: { "x-lcsp-locale": locale } },
      );
      if (getAppLocaleSnapshot() !== locale)
        throw new Error("Assessment locale changed during request");
      return result;
    },
    enabled: Boolean(id) && artifactId !== null,
  });
}

/** The immutable, validated provenance artifact of one assessment. */
export function useAssessmentProvenanceQuery(id: string) {
  return useQuery({
    queryKey: assessmentDomainKeys.provenance(id),
    queryFn: () =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/provenance`,
        assessmentProvenanceArtifactSchema,
      ),
    enabled: Boolean(id),
  });
}
