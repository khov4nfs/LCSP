"use client";
import { useMemo } from "react";
import {
  useAssessmentDetailQuery,
  useAssessmentEventsQuery,
  useHumanRequestsQuery,
  useRepositorySetupQuery,
} from "@/lib/api/assessment-domain-queries";
import { projectConversation } from "../utils/conversation-projection";

type AssessmentConversation = {
  detail: ReturnType<typeof useAssessmentDetailQuery>;
  requests: ReturnType<typeof useHumanRequestsQuery>;
  events: ReturnType<typeof useAssessmentEventsQuery>;
  setup: ReturnType<typeof useRepositorySetupQuery>;
  projection: ReturnType<typeof projectConversation>;
};

/**
 * Business purpose: Build the single Assessment conversation view from canonical server projections.
 * Business rules:
 * - Detail, human requests, event history, and repository setup remain independently authoritative.
 * - Live updates and reloads must feed the same pure conversation projection.
 * Execution flow:
 * 1. Subscribe to each Assessment query and project their available values into conversation entries.
 * 2. Expose both the source query states and the memoized projection to the runtime UI.
 * Failure cases:
 * - Source query failures remain visible on their owning query result; no fallback facts are invented.
 * Side effects:
 * - Registers query subscriptions; the memoized projection itself is pure and performs no writes.
 */
export function useAssessmentConversation(
  assessmentId: string,
): AssessmentConversation {
  const detail = useAssessmentDetailQuery(assessmentId);
  const requests = useHumanRequestsQuery(assessmentId);
  const events = useAssessmentEventsQuery(assessmentId);
  const setup = useRepositorySetupQuery(assessmentId);
  const projection = useMemo(
    () =>
      projectConversation({
        assessmentId,
        events: events.data ?? [],
        detail: detail.data ?? null,
        requests: requests.data?.requests ?? [],
        repository: setup.data?.connection
          ? {
              fullName: setup.data.connection.repositoryFullName,
              commit: setup.data.snapshot?.commitSha ?? null,
            }
          : null,
      }),
    [assessmentId, events.data, detail.data, requests.data, setup.data],
  );
  return { detail, requests, events, setup, projection };
}
