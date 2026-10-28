"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_EVENTS_PAGE_LIMIT,
  assessmentDetailSchema,
  assessmentEventsPageSchema,
  assessmentFinalReportArtifactSchema,
  assessmentHumanRequestsResultSchema,
  assessmentProvenanceArtifactSchema,
  assessmentRepositorySetupSchema,
  reconcileOrphanedAssessmentResultSchema,
  answerAssessmentHumanRequestSchema,
  answerAssessmentHumanRequestResultSchema,
  type AnswerAssessmentHumanRequest,
} from "@lcsp/contracts/assessment-domain";
import type { AssessmentEvent } from "@lcsp/contracts/assessment";
import { apiValidated } from "./api-request";

export const assessmentDomainKeys = {
  detail: (id: string) => ["assessment", id, "detail"] as const,
  requests: (id: string) => ["assessment", id, "human-requests"] as const,
  setup: (id: string) => ["assessment", id, "repository-setup"] as const,
  events: (id: string) => ["assessment", id, "events"] as const,
  provenance: (id: string) => ["assessment", id, "provenance"] as const,
};
export function useAssessmentDetailQuery(id: string) {
  return useQuery({
    queryKey: assessmentDomainKeys.detail(id),
    queryFn: () =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}`,
        assessmentDetailSchema,
      ),
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
export function useHumanRequestsQuery(id: string) {
  return useQuery({
    queryKey: assessmentDomainKeys.requests(id),
    queryFn: () =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/human-requests`,
        assessmentHumanRequestsResultSchema,
      ),
    enabled: Boolean(id),
  });
}
/** Hard stop for a runaway read; a real assessment is a few hundred events. */
const MAX_EVENT_PAGES = 40;

/**
 * Every canonical event of one assessment, ascending by sequence: the conversation's single source,
 * identical for live updates and reloads. Refetches are incremental (only events after the last one
 * already held) and merge by sequence, so the same event can never render twice.
 */
export function useAssessmentEventsQuery(id: string) {
  const client = useQueryClient();
  const key = assessmentDomainKeys.events(id);
  return useQuery({
    queryKey: key,
    enabled: Boolean(id),
    queryFn: async () => {
      const known = client.getQueryData<AssessmentEvent[]>(key) ?? [];
      const bySequence = new Map(known.map((event) => [event.sequence, event]));
      let after = known.at(-1)?.sequence ?? 0;
      for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
        const result = await apiValidated(
          `/api/assessments/${encodeURIComponent(id)}/events?afterSequence=${after}&limit=${ASSESSMENT_EVENTS_PAGE_LIMIT}`,
          assessmentEventsPageSchema,
        );
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

/** The stored final report of one assessment, parsed against the artifact contract. */
export function useAssessmentReportQuery(id: string, artifactId: string | null) {
  return useQuery({
    queryKey: ["assessment", id, "report", artifactId] as const,
    queryFn: () =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId ?? "")}/report`,
        assessmentFinalReportArtifactSchema,
      ),
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
