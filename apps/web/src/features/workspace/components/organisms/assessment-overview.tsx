"use client";

import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentInterviewBlockedAction,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { useState } from "react";

import {
  useAssessmentInterviewBlockedActionMutation,
  useAssessmentInterviewStateQuery,
  useSubmitAssessmentInterviewAnswerMutation,
} from "@/lib/api/assessment-queries";
import { appLocale } from "@/lib/locale";

import type { AssessmentOverviewProps } from "../../types/assessment-overview.types";
import { TOOL_ACTIVITY_STATUSES } from "../../types/assessment-chat.types";
import { AgentTurn } from "../molecules/agent-turn";
import {
  AssessmentQuestionTurn,
  type AssessmentQuestionAnswerInput,
} from "../molecules/assessment-question-turn";
import { ToolActivityRow } from "../molecules/tool-activity-row";
import { AssessmentComposer } from "./assessment-composer";
import { AssessmentTranscript } from "./assessment-transcript";
import { useWorkspaceRuntime } from "./workspace-runtime-provider";

export function AssessmentOverview({ assessmentId }: AssessmentOverviewProps) {
  const runtime = useWorkspaceRuntime().getAssessmentRuntime(assessmentId);
  const interviewQuery = useAssessmentInterviewStateQuery(assessmentId);
  const submitAnswer = useSubmitAssessmentInterviewAnswerMutation(assessmentId);
  const recordBlockedAction =
    useAssessmentInterviewBlockedActionMutation(assessmentId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null);
  const interviewState: AssessmentInterviewRuntimeState = interviewQuery.data ?? {
    outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
  };
  const draft = drafts[assessmentId] ?? interviewState.pendingDraft ?? "";
  const answerHistory = interviewState.answerHistory ?? [];

  function persistDraft(value: string) {
    setDrafts((current) => ({ ...current, [assessmentId]: value }));
  }

  function clearDraft() {
    setDrafts((current) => {
      const next = { ...current };
      delete next[assessmentId];
      return next;
    });
  }

  function handleSubmit() {
    if (!interviewState.activeQuestion || draft.trim().length === 0) {
      return;
    }
    handleQuestionAnswer({
      questionId: interviewState.activeQuestion.id,
      freeText: draft,
    });
  }

  function handleQuestionAnswer(input: AssessmentQuestionAnswerInput) {
    submitAnswer.mutate(input, {
      onSuccess: () => {
        clearDraft();
        setLastSavedMessage(t("pages.assessment.answerSavedForRuntime"));
      },
    });
  }

  function handleBlockedAction(action: AssessmentInterviewBlockedAction) {
    recordBlockedAction.mutate(
      {
        action,
        draft:
          action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
            ? draft
            : undefined,
      },
      {
        onSuccess: () => {
          if (action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit) {
            clearDraft();
            setLastSavedMessage(t("pages.assessment.draftSavedForResume"));
            return;
          }
          setLastSavedMessage(t("pages.assessment.blockedActionRecorded"));
        },
      },
    );
  }

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-assessment-id={assessmentId}
      data-surface="workflow-run"
    >
      <AssessmentTranscript autoScrollKey={assessmentId}>
        <AgentTurn
          content={
            <>
              <p className="font-medium">
                {t("pages.assessment.workflowRunTitle")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {t("pages.assessment.workflowRunDescription")}
              </p>
            </>
          }
        />

        <AgentTurn>
          <div className="space-y-2">
            {runtime.currentRun?.activeTools.length ? (
              runtime.currentRun.activeTools.map((tool) => (
                <ToolActivityRow
                  key={`${tool.toolName}:${tool.startedAt ?? tool.attempt ?? "active"}`}
                  label={tool.summary || tool.toolName}
                  status={runtimeToolStatus(tool.status)}
                />
              ))
            ) : (
              <ToolActivityRow
                label={t("pages.assessment.runtimeWaitingForAgent")}
                status={TOOL_ACTIVITY_STATUSES.pending}
              />
            )}
          </div>
        </AgentTurn>

        {runtime.recentActivity.slice(0, 4).map((event) => (
          <AgentTurn key={event.eventId}>
            <p className="text-sm text-muted-foreground">{event.summary}</p>
          </AgentTurn>
        ))}

        {answerHistory.map((answer) => (
          <AgentTurn key={`${answer.questionId}:${answer.answeredAt}`}>
            <p className="text-sm text-muted-foreground">
              {t("pages.assessment.answerHistoryPrefix")} {answer.summary}
            </p>
          </AgentTurn>
        ))}

        {interviewState.activeQuestion ? (
          <AgentTurn>
            <AssessmentQuestionTurn
              question={interviewState.activeQuestion}
              blockedActions={interviewState.blockedActions ?? []}
              initialDraft={draft}
              onDraftChange={persistDraft}
              onSubmitAnswer={handleQuestionAnswer}
              onBlockedAction={handleBlockedAction}
            />
          </AgentTurn>
        ) : (
          <AgentTurn>
            <p className="text-sm text-muted-foreground">
              {interviewQuery.isLoading
                ? t("pages.assessment.loadingInterviewState")
                : interviewState.orchestrationRequested
                  ? t("pages.assessment.runtimeWaitingForAgent")
                  : t("pages.assessment.noActiveInterviewQuestion")}
            </p>
          </AgentTurn>
        )}

        {lastSavedMessage ? (
          <AgentTurn>
            <p className="text-sm text-muted-foreground">{lastSavedMessage}</p>
          </AgentTurn>
        ) : null}
      </AssessmentTranscript>

      <AssessmentComposer
        value={draft}
        onValueChange={persistDraft}
        onSubmit={handleSubmit}
      />
    </main>
  );
}

function runtimeToolStatus(status: string) {
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed) {
    return TOOL_ACTIVITY_STATUSES.completed;
  }
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed) {
    return TOOL_ACTIVITY_STATUSES.failed;
  }
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.running) {
    return TOOL_ACTIVITY_STATUSES.running;
  }
  return TOOL_ACTIVITY_STATUSES.pending;
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
