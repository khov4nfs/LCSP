"use client";

import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentInterviewBlockedAction,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { SaveIcon, TextCursorInputIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  useAssessmentInterviewBlockedActionMutation,
  useAssessmentInterviewStateQuery,
  useSubmitAssessmentInterviewAnswerMutation,
} from "@/lib/api/assessment-queries";
import { appLocale } from "@/lib/locale";

import type { AssessmentOverviewProps } from "../../types/assessment-overview.types";
import {
  ASSESSMENT_CHAT_ROLES,
  TOOL_ACTIVITY_STATUSES,
} from "../../types/assessment-chat.types";
import {
  ASSESSMENT_RUNTIME_AVAILABILITIES,
} from "../../types/assessment-runtime-adapter.types";
import { useAssessmentRuntimeViewModel } from "../../hooks/use-assessment-runtime-view-model";
import {
  selectComposerAvailability,
  selectCustomerActions,
  selectInterviewPresentation,
  selectWorkflowPresentation,
} from "../../utils/assessment-runtime-selectors";
import { AgentMessage, AgentTurn } from "../molecules/agent-turn";
import {
  AssessmentQuestionTurn,
  type AssessmentQuestionAnswerInput,
} from "../molecules/assessment-question-turn";
import {
  ToolActivityList,
  ToolActivityRow,
} from "../molecules/tool-activity-row";
import { AssessmentComposer } from "./assessment-composer";
import { AssessmentTranscript } from "./assessment-transcript";

export function AssessmentOverview({ assessmentId }: AssessmentOverviewProps) {
  // Query hook reference preserved for reactivity & test compatibility
  const interviewQuery = useAssessmentInterviewStateQuery(assessmentId);
  const normalized = useAssessmentRuntimeViewModel(assessmentId);
  const interview = selectInterviewPresentation(normalized);
  const workflow = selectWorkflowPresentation(normalized);
  const customerActions = selectCustomerActions(normalized);
  const composerAvailability = selectComposerAvailability(normalized);
  const submitAnswer = useSubmitAssessmentInterviewAnswerMutation(assessmentId);
  const recordBlockedAction =
    useAssessmentInterviewBlockedActionMutation(assessmentId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null);

  const draft = drafts[assessmentId] ?? interview.pendingDraft ?? "";
  const answerHistory = interview.answerHistory;
  const autoScrollKey = [
    assessmentId,
    workflow.currentRunId,
    workflow.status,
    normalized.workflow.latestRun?.updatedAt ?? workflow.lastEmittedAt,
    // runtime.currentRun?.updatedAt
    // runtime.currentRun?.activeTools
    // runtime.recentActivity.map
    workflow.activeTools
      .map((tool) => `${tool.toolName}:${tool.status}:${tool.startedAt ?? ""}`)
      .join("|"),
    workflow.recentActivity.map((event) => event.eventId).join("|"),
    interviewQuery.dataUpdatedAt,
    interview.activeQuestion?.id,
    answerHistory.length,
    lastSavedMessage,
  ].join("::");

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
    if (
      !interview.activeQuestion ||
      draft.trim().length === 0 ||
      !customerActions.canSubmitDraft ||
      !customerActions.canAnswerQuestion
    ) {
      return;
    }
    handleQuestionAnswer({
      questionId: interview.activeQuestion.id,
      freeText: draft,
    });
  }

  function handleQuestionAnswer(input: AssessmentQuestionAnswerInput) {
    if (!customerActions.canAnswerQuestion) {
      return;
    }
    submitAnswer.mutate(input, {
      onSuccess: () => {
        clearDraft();
        setLastSavedMessage(t("pages.assessment.answerSavedForRuntime"));
      },
    });
  }

  function handleBlockedAction(action: AssessmentInterviewBlockedAction) {
    if (!customerActions.canSubmitBlockedAction) {
      return;
    }
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
      <AssessmentTranscript autoScrollKey={autoScrollKey}>
        <AgentTurn
          content={
            <AgentMessage>
              <p className="font-medium">
                {t("pages.assessment.workflowRunTitle")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {t("pages.assessment.workflowRunDescription")}
              </p>
            </AgentMessage>
          }
        />

        <AgentTurn>
          <ToolActivityList>
            {workflow.activeTools.length ? (
              workflow.activeTools.map((tool) => (
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
          </ToolActivityList>
        </AgentTurn>

        {workflow.recentActivity.slice(0, 4).map((event) => (
          <AgentTurn key={event.eventId}>
            <AgentMessage className="text-muted-foreground">
              {event.summary}
            </AgentMessage>
          </AgentTurn>
        ))}

        {answerHistory.map((answer) => (
          <AgentTurn
            key={`${answer.questionId}:${answer.answeredAt}`}
            role={ASSESSMENT_CHAT_ROLES.user}
          >
            <p className="text-sm text-muted-foreground">
              {t("pages.assessment.answerHistoryPrefix")} {answer.summary}
            </p>
          </AgentTurn>
        ))}

        {interview.questionTurnProps ? (
          <AgentTurn
            terminalAction={
              <AssessmentQuestionTurn
                question={interview.questionTurnProps.question}
                blockedActions={interview.questionTurnProps.blockedActions}
                disabled={!customerActions.canAnswerQuestion}
                initialDraft={draft}
                onDraftChange={persistDraft}
                onSubmitAnswer={handleQuestionAnswer}
                onBlockedAction={handleBlockedAction}
              />
            }
          />
        ) : interview.isBlocked &&
          customerActions.canSubmitBlockedAction &&
          customerActions.availableBlockedActions.length > 0 ? (
          <AgentTurn
            terminalAction={
              <div
                data-slot="blocked-or-unresolved-actions"
                className="flex flex-wrap gap-2"
              >
                {customerActions.availableBlockedActions.map((action) => (
                  <Button
                    key={action}
                    type="button"
                    size="sm"
                    variant={
                      action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
                        ? "outline"
                        : "secondary"
                    }
                    onClick={() => handleBlockedAction(action)}
                  >
                    {action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit ? (
                      <SaveIcon />
                    ) : (
                      <TextCursorInputIcon />
                    )}
                    {blockedActionLabel(action)}
                  </Button>
                ))}
              </div>
            }
          >
            <AgentMessage className="text-muted-foreground">
              {t("pages.assessment.blockedActionRecorded")}
            </AgentMessage>
          </AgentTurn>
        ) : (
          <AgentTurn>
            <AgentMessage className="text-muted-foreground">
              {normalized.availability === ASSESSMENT_RUNTIME_AVAILABILITIES.loading
                ? t("pages.assessment.loadingInterviewState")
                : interview.orchestrationRequested
                  ? t("pages.assessment.runtimeWaitingForAgent")
                  : t("pages.assessment.noActiveInterviewQuestion")}
            </AgentMessage>
          </AgentTurn>
        )}

        {lastSavedMessage ? (
          <AgentTurn>
            <AgentMessage className="text-muted-foreground">
              {lastSavedMessage}
            </AgentMessage>
          </AgentTurn>
        ) : null}
      </AssessmentTranscript>

      <AssessmentComposer
        value={draft}
        disabled={!composerAvailability.isEnabled}
        submitting={submitAnswer.isPending || recordBlockedAction.isPending}
        placeholder={t(composerAvailability.placeholderKey)}
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

function blockedActionLabel(action: AssessmentInterviewBlockedAction) {
  if (action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext) {
    return t("pages.assessment.blockedProvideMoreContext");
  }
  if (action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally) {
    return t("pages.assessment.blockedCheckInternally");
  }
  return t("pages.assessment.blockedSaveExit");
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

