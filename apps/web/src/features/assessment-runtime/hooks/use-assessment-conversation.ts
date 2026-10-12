"use client";
import { useMemo } from "react";
import {
  useAssessmentDetailQuery,
  useAssessmentEventsQuery,
  useHumanRequestsQuery,
  useRepositorySetupQuery,
} from "@/lib/api/assessment-domain-queries";
import { projectConversation } from "../utils/conversation-projection";

/**
 * The conversation's one data path: canonical detail, human requests and the full event history
 * feed the one pure projection. The live stream and a reload both end up here.
 */
export function useAssessmentConversation(assessmentId: string) {
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
