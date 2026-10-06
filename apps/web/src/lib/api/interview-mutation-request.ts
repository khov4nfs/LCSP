import {
  ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { apiRequest } from "./api-request.ts";
import { InterviewMutationError } from "./interview-mutation-recovery.ts";

/** Mutations must reject Problem Responses; null would incorrectly trigger onSuccess. */
export async function requestInterviewMutation(
  url: string,
  init: RequestInit,
): Promise<AssessmentInterviewRuntimeState> {
  const result = await apiRequest(url, init);
  if (!result.ok) {
    const definitive = Boolean(
      result.problemCode && result.status >= 400 && result.status < 500 && result.status !== 408,
    );
    throw new InterviewMutationError(
      result.problemCode ?? ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES.requestPending,
      result.status,
      definitive,
    );
  }
  const state = result.payload as Partial<AssessmentInterviewRuntimeState> | null;
  if (
    !state || typeof state !== "object" ||
    !Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(state.outcome as never) ||
    !Number.isSafeInteger(state.contextRevision) ||
    (state.contextRevision as number) < 0 ||
    typeof state.threadId !== "string" || !state.threadId
  ) {
    throw new InterviewMutationError(
      ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES.requestPending,
      result.status,
      false,
    );
  }
  return state as AssessmentInterviewRuntimeState;
}
