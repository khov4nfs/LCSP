"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_EVENTS_PAGE_LIMIT,
  assessmentDetailSchema,
  assessmentEventsPageSchema,
  assessmentFinalReportArtifactSchema,
  assessmentHumanRequestsResultSchema,
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

export function useReconcileOrphanedAssessment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiValidated(
        `/api/assessments/${encodeURIComponent(id)}/reconcile-orphaned`,
        reconcileOrphanedAssessmentResultSchema,
        { method: "POST" },
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: assessmentDomainKeys.detail(id) }),
        client.invalidateQueries({ queryKey: assessmentDomainKeys.events(id) }),
        client.invalidateQueries({ queryKey: assessmentDomainKeys.requests(id) }),
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
