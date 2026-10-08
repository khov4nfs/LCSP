"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assessmentDetailSchema,
  assessmentHumanRequestsResultSchema,
  assessmentRepositorySetupSchema,
  answerAssessmentHumanRequestSchema,
  answerAssessmentHumanRequestResultSchema,
  type AnswerAssessmentHumanRequest,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated } from "./api-request";

export const assessmentDomainKeys = {
  detail: (id: string) => ["assessment", id, "detail"] as const,
  requests: (id: string) => ["assessment", id, "human-requests"] as const,
  setup: (id: string) => ["assessment", id, "repository-setup"] as const,
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
