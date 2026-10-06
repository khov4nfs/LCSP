"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AssessmentInterviewAnswerInput,
  AssessmentInterviewBlockedInput,
  AssessmentInterviewRuntimeState,
  SubmitInterviewAnswerCommand,
} from "@lcsp/contracts/evidence";
import {
  buildInterviewBlockedActionCommand,
  buildSubmitInterviewAnswerCommand,
  recordAssessmentInterviewBlockedAction,
  submitAssessmentInterviewAnswer,
} from "./assessment-interview-client";
import {
  createInterviewMutationRetrier,
  isInterviewMutationConflict,
} from "./interview-mutation-recovery";
import { apiQueryKeys } from "./query-keys";

function keepNewestInterviewState(
  current: AssessmentInterviewRuntimeState | null | undefined,
  received: AssessmentInterviewRuntimeState,
) {
  // A response from an earlier turn must not replace a newer SSE/refetch result.
  return (current?.contextRevision ?? -1) > (received.contextRevision ?? -1)
    ? current
    : received;
}

export function useSubmitAssessmentInterviewAnswerMutation(assessmentId: string) {
  const queryClient = useQueryClient();
  const retrier = useMemo(
    () => createInterviewMutationRetrier<SubmitInterviewAnswerCommand>(),
    [assessmentId],
  );
  const mutation = useMutation({
    retry: false,
    mutationFn: (input: {
      answer: AssessmentInterviewAnswerInput;
      state: AssessmentInterviewRuntimeState;
    } | undefined) => retrier.run(
      input ? buildSubmitInterviewAnswerCommand(assessmentId, input.state, input.answer) : undefined,
      (command) => submitAssessmentInterviewAnswer(assessmentId, command),
    ),
    onSuccess: async (state) => {
      queryClient.setQueryData<AssessmentInterviewRuntimeState | null>(
        apiQueryKeys.assessment.interview(assessmentId),
        (current) => keepNewestInterviewState(current, state),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: apiQueryKeys.assessment.interview(assessmentId) }),
        queryClient.invalidateQueries({ queryKey: apiQueryKeys.assessment.artifacts(assessmentId) }),
      ]);
    },
    onError: async (error) => {
      if (isInterviewMutationConflict(error)) {
        await queryClient.invalidateQueries({ queryKey: apiQueryKeys.assessment.interview(assessmentId) });
      }
    },
  });
  return { ...mutation, hasPendingRequest: retrier.hasPending() };
}

export function useAssessmentInterviewBlockedActionMutation(assessmentId: string) {
  const queryClient = useQueryClient();
  const retrier = useMemo(
    () => createInterviewMutationRetrier<AssessmentInterviewBlockedInput>(),
    [assessmentId],
  );
  const mutation = useMutation({
    retry: false,
    mutationFn: (input: {
      blocked: Pick<AssessmentInterviewBlockedInput, "action" | "draft">;
      state: AssessmentInterviewRuntimeState;
    } | undefined) => retrier.run(
      input ? buildInterviewBlockedActionCommand(input.state, input.blocked) : undefined,
      (command) => recordAssessmentInterviewBlockedAction(assessmentId, command),
    ),
    onSuccess: async (state) => {
      queryClient.setQueryData<AssessmentInterviewRuntimeState | null>(
        apiQueryKeys.assessment.interview(assessmentId),
        (current) => keepNewestInterviewState(current, state),
      );
      await queryClient.invalidateQueries({ queryKey: apiQueryKeys.assessment.interview(assessmentId) });
    },
    onError: async (error) => {
      if (isInterviewMutationConflict(error)) {
        await queryClient.invalidateQueries({ queryKey: apiQueryKeys.assessment.interview(assessmentId) });
      }
    },
  });
  return { ...mutation, hasPendingRequest: retrier.hasPending() };
}
