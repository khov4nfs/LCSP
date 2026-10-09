"use client";

import {
  ASSESSMENT_INTERVIEW_CONTROLS,
  type AssessmentInterviewQuestion,
} from "@lcsp/contracts/evidence";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";
import {
  useAssessmentInterviewStateQuery,
  useSubmitAssessmentInterviewAnswerMutation,
} from "@/lib/api/assessment-queries";
import { AssessmentComposer } from "./assessment-composer";
import {
  AssessmentQuestionTurn,
  type AssessmentQuestionAnswerInput,
} from "../molecules/assessment-question-turn";
import { useAssessmentRuntimeViewModel } from "../../hooks/use-assessment-runtime-view-model";
import {
  CANONICAL_INTERVIEW_PRESENTATION_STATES,
  selectCanonicalInterviewPresentation,
} from "../../utils/canonical-interview-presentation";
import {
  composerModeForAnswerMode,
  deriveInterviewAnswerMode,
  INTERVIEW_COMPOSER_MODES,
} from "../../utils/interview-answer-mode";
import type { NormalizedAssessmentRuntime } from "../../types/assessment-runtime-adapter.types";

type CanonicalInterviewPanelProps = {
  assessmentId: string;
  lifecycleState: Parameters<
    typeof selectCanonicalInterviewPresentation
  >[0]["lifecycleState"];
  canonicalAvailable: boolean;
};

type InterviewDraft = {
  questionId: string;
  freeText: string;
  selectedChoiceIds: string[];
  otherText: string;
  isAdjusting: boolean;
};

const emptyDraft = (questionId: string, pendingDraft = ""): InterviewDraft => ({
  questionId,
  freeText: pendingDraft,
  selectedChoiceIds: [],
  otherText: "",
  isAdjusting: false,
});

export function CanonicalInterviewPanel({
  assessmentId,
  lifecycleState,
  canonicalAvailable,
}: CanonicalInterviewPanelProps) {
  const interviewQuery = useAssessmentInterviewStateQuery(assessmentId);
  const runtime = useAssessmentRuntimeViewModel(assessmentId);
  const submitAnswer = useSubmitAssessmentInterviewAnswerMutation(assessmentId);
  const presentation = selectCanonicalInterviewPresentation({
    lifecycleState,
    interview: runtime.interview,
    customerActions: runtime.customerActions,
    queryPending: interviewQuery.isPending,
    queryError: interviewQuery.isError,
    canonicalAvailable,
  });
  const activeQuestion = presentation.activeQuestion;
  const activeQuestionId = activeQuestion?.id ?? "";
  const previousQuestionId = useRef(activeQuestionId);
  const [draft, setDraft] = useState<InterviewDraft>(() =>
    emptyDraft(activeQuestionId, runtime.interview.pendingDraft ?? ""),
  );
  const [lockedQuestionId, setLockedQuestionId] = useState<string | null>(null);
  const [submittedQuestionId, setSubmittedQuestionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (previousQuestionId.current === activeQuestionId) return;
    previousQuestionId.current = activeQuestionId;
    setDraft(emptyDraft(activeQuestionId, runtime.interview.pendingDraft ?? ""));
    setLockedQuestionId(null);
    setSubmittedQuestionId(null);
  }, [activeQuestionId, runtime.interview.pendingDraft]);

  const selectedChoiceRequiresFreeText = Boolean(
    activeQuestion?.choices?.some(
      (choice) =>
        choice.requiresFreeText && draft.selectedChoiceIds.includes(choice.id),
    ),
  );
  const questionLocked =
    Boolean(activeQuestionId) &&
    (lockedQuestionId === activeQuestionId ||
      submittedQuestionId === activeQuestionId);
  // The retrier intentionally keeps an uncertain command after a transport
  // failure so the user can retry it with the same clientRequestId. That
  // retained command is not an in-flight mutation and must not keep the UI
  // locked after the ordinary error has been surfaced.
  const mutationPending = submitAnswer.isPending;
  const interactive =
    presentation.state ===
    CANONICAL_INTERVIEW_PRESENTATION_STATES.interactiveEligible;
  const answerMode = deriveInterviewAnswerMode({
    question: activeQuestion,
    selectedChoiceRequiresFreeText,
    isAdjusting: draft.isAdjusting,
    pending: mutationPending,
    submitted: questionLocked,
    stale: runtime.interview.stale,
    revalidating: runtime.interview.revalidating,
    canAnswer: interactive,
  });
  const composerMode = composerModeForAnswerMode(answerMode);
  const composerValue =
    composerMode === INTERVIEW_COMPOSER_MODES.requiredSelectionText
      ? draft.otherText
      : draft.freeText;
  const submitReady = isAnswerReady({
    question: activeQuestion,
    draft,
    selectedChoiceRequiresFreeText,
    interactive,
    questionLocked,
    mutationPending,
  });

  if (interviewQuery.isPending && !interviewQuery.data) {
    return <InterviewLoading />;
  }

  if (interviewQuery.isError && !interviewQuery.data) {
    return (
      <section data-slot="canonical-interview-panel">
        <Alert variant="destructive">
          <AlertDescription>
            {resolveAppMessage("pages.agenticAssessment.requestFailed")} {" "}
            <Button
              variant="outline"
              onClick={() => void interviewQuery.refetch()}
            >
              {resolveAppMessage("pages.agenticAssessment.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  if (presentation.state === CANONICAL_INTERVIEW_PRESENTATION_STATES.hidden) {
    return null;
  }

  function updateDraft(update: Partial<InterviewDraft>) {
    if (!interactive || questionLocked || mutationPending) return;
    setDraft((current) => ({ ...current, ...update }));
  }

  function submit(input: AssessmentQuestionAnswerInput) {
    if (
      !activeQuestion ||
      !interviewQuery.data ||
      !interactive ||
      !submitReadyForInput(
        input,
        activeQuestion,
        draft,
        selectedChoiceRequiresFreeText,
      ) ||
      questionLocked ||
      mutationPending ||
      runtime.interview.stale ||
      runtime.interview.revalidating
    ) {
      return;
    }
    setLockedQuestionId(input.questionId);
    submitAnswer.mutate(
      { answer: input, state: interviewQuery.data },
      {
        onSuccess: () => {
          setSubmittedQuestionId(input.questionId);
          setDraft(emptyDraft(input.questionId));
        },
        onError: () => {
          setLockedQuestionId((current) =>
            current === input.questionId ? null : current,
          );
        },
      },
    );
  }

  function submitCurrentAnswer() {
    if (!activeQuestion) return;
    const input: AssessmentQuestionAnswerInput = {
      questionId: activeQuestion.id,
    };
    if (activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
      input.freeText = draft.freeText.trim();
    } else if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust
    ) {
      input.adjusted = true;
      input.freeText = draft.freeText.trim();
    } else {
      input.selectedChoiceIds = draft.selectedChoiceIds;
      if (selectedChoiceRequiresFreeText) {
        input.otherText = draft.otherText.trim();
      }
    }
    submit(input);
  }

  return (
    <section
      data-slot="canonical-interview-panel"
      data-presentation-state={presentation.state}
      data-interview-outcome={presentation.interviewOutcome ?? undefined}
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      {activeQuestion ? (
        <AssessmentQuestionTurn
          assessmentId={assessmentId}
          question={activeQuestion}
          answerHistoryVisible={presentation.answerHistory.length > 0}
          historical={false}
          selectedChoiceIds={draft.selectedChoiceIds}
          onSelectedChoiceIdsChange={(selectedChoiceIds) =>
            updateDraft({ selectedChoiceIds })
          }
          isAdjusting={draft.isAdjusting}
          onAdjust={() => updateDraft({ isAdjusting: true })}
          canSubmitSelection={submitReady}
          selectionPending={mutationPending}
          selectionSubmitted={submittedQuestionId === activeQuestion.id}
          onSubmitSelection={submitCurrentAnswer}
          disabled={!interactive || questionLocked || mutationPending}
          onSubmitAnswer={submit}
        />
      ) : null}
      {presentation.answerHistory.length > 0 ? (
        <InterviewHistory items={presentation.answerHistory} />
      ) : null}
      {activeQuestion && interactive ? (
        <AssessmentComposer
          value={composerValue}
          disabled={composerMode === INTERVIEW_COMPOSER_MODES.disabled}
          submitEnabled={
            composerMode === INTERVIEW_COMPOSER_MODES.freeText ||
            composerMode === INTERVIEW_COMPOSER_MODES.adjustmentText
          }
          submitReady={submitReady}
          submitting={mutationPending || questionLocked}
          placeholder={composerPlaceholder(
            activeQuestion,
            selectedChoiceRequiresFreeText,
            draft.isAdjusting,
          )}
          onValueChange={(value) =>
            composerMode === INTERVIEW_COMPOSER_MODES.requiredSelectionText
              ? updateDraft({ otherText: value })
              : updateDraft({ freeText: value })
          }
          onSubmit={submitCurrentAnswer}
        />
      ) : null}
    </section>
  );
}

function isAnswerReady({
  question,
  draft,
  selectedChoiceRequiresFreeText,
  interactive,
  questionLocked,
  mutationPending,
}: {
  question: AssessmentInterviewQuestion | null;
  draft: InterviewDraft;
  selectedChoiceRequiresFreeText: boolean;
  interactive: boolean;
  questionLocked: boolean;
  mutationPending: boolean;
}) {
  if (!question || !interactive || questionLocked || mutationPending) return false;
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText)
    return draft.freeText.trim().length > 0;
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust)
    return draft.isAdjusting && draft.freeText.trim().length > 0;
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect) {
    return (
      draft.selectedChoiceIds.length > 0 &&
      (!selectedChoiceRequiresFreeText || draft.otherText.trim().length > 0)
    );
  }
  return (
    draft.selectedChoiceIds.length === 1 &&
    (!selectedChoiceRequiresFreeText || draft.otherText.trim().length > 0)
  );
}

function submitReadyForInput(
  input: AssessmentQuestionAnswerInput,
  question: AssessmentInterviewQuestion,
  draft: InterviewDraft,
  selectedChoiceRequiresFreeText: boolean,
) {
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    return (
      input.confirmed === true ||
      (input.adjusted === true && Boolean(input.freeText?.trim()))
    );
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    return Boolean(input.freeText?.trim());
  }
  const selected = input.selectedChoiceIds ?? draft.selectedChoiceIds;
  return (
    selected.length > 0 &&
    (!selectedChoiceRequiresFreeText || Boolean(input.otherText?.trim()))
  );
}

function composerPlaceholder(
  question: AssessmentInterviewQuestion,
  requiresText: boolean,
  isAdjusting: boolean,
) {
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    return t(
      isAdjusting
        ? "pages.assessment.adjustPlaceholder"
        : "pages.assessment.composerChooseConfirmAdjust",
    );
  }
  if (requiresText) return t("pages.assessment.otherDescribe");
  return t("pages.assessmentFlow.interview.placeholder");
}

function InterviewLoading() {
  return (
    <section data-slot="canonical-interview-panel" aria-busy="true">
      <p className="text-sm text-muted-foreground" role="status">
        {t("pages.assessment.loadingInterviewState")}
      </p>
    </section>
  );
}

function InterviewHistory({
  items,
}: {
  items: NormalizedAssessmentRuntime["interview"]["answerHistory"];
}) {
  return (
    <div data-slot="canonical-interview-history" className="space-y-3">
      {items.map((item) => (
        <article
          key={`${item.questionId}:${item.answeredAt}`}
          data-history-question-id={item.questionId}
          className="rounded-md bg-muted/40 px-3 py-3"
        >
          {item.question?.prompt ? (
            <p className="text-sm text-foreground">{item.question.prompt}</p>
          ) : null}
          {item.question?.proposedInterpretation ? (
            <div
              data-slot="proposed-interpretation"
              className="rounded-lg border bg-muted/30 p-3.5 text-sm leading-6 text-foreground"
            >
              <p className="whitespace-pre-wrap">
                {item.question.proposedInterpretation}
              </p>
            </div>
          ) : null}
          <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
          {item.comment ? (
            <p className="mt-1 text-sm text-muted-foreground">{item.comment}</p>
          ) : null}
          <time
            className="mt-2 block text-xs text-muted-foreground"
            dateTime={item.answeredAt}
          >
            {item.answeredAt}
          </time>
        </article>
      ))}
    </div>
  );
}

function t(key: MessageKey) {
  return resolveMessage(appLocale, key);
}
