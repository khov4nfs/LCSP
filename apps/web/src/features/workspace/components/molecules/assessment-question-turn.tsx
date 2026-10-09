"use client";

import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  type AssessmentInterviewBlockedAction,
  type AssessmentInterviewQuestion,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import {
  CheckIcon,
  Code2Icon,
  Edit3Icon,
  HelpCircleIcon,
  SaveIcon,
  SendIcon,
  TextCursorInputIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { useAssessmentInterviewSourceSnippetQuery } from "@/lib/api/assessment-queries";

import { ChatMultiSelect } from "./chat-multi-select";
import { ChatSingleSelect } from "./chat-single-select";
import { SelectionHistoryRow } from "./selection-history-row";

export type AssessmentQuestionAnswerInput = {
  questionId: string;
  freeText?: string;
  selectedChoiceIds?: string[];
  otherText?: string;
  confirmed?: boolean;
  adjusted?: boolean;
};

type AssessmentQuestionTurnProps = {
  assessmentId?: string;
  question: AssessmentInterviewQuestion;
  answerHistoryVisible?: boolean;
  /** This is a resolved, already-answered turn (rendered from history), not
   *  the live active question — hide interactive actions (Confirm/Adjust)
   *  there's nothing left to act on. Deliberately separate from
   *  answerHistoryVisible: that prop is also true for the LIVE active
   *  question whenever any prior answer exists in the transcript, which is
   *  not the same thing as this particular question being resolved. */
  historical?: boolean;
  selectedChoiceIds?: string[];
  onSelectedChoiceIdsChange?: (choiceIds: string[]) => void;
  isAdjusting?: boolean;
  onAdjust?: () => void;
  canSubmitSelection?: boolean;
  hideSubmitSelection?: boolean;
  onSubmitSelection?: () => void;
  blockedActions?: AssessmentInterviewBlockedAction[];
  className?: string;
  disabled?: boolean;
  onSubmitAnswer?: (input: AssessmentQuestionAnswerInput) => void;
  onBlockedAction?: (action: AssessmentInterviewBlockedAction) => void;
};

export function AssessmentQuestionTurn({
  assessmentId,
  question,
  answerHistoryVisible = false,
  historical = false,
  selectedChoiceIds = [],
  onSelectedChoiceIdsChange,
  isAdjusting = false,
  onAdjust,
  canSubmitSelection = false,
  hideSubmitSelection = false,
  onSubmitSelection,
  blockedActions = [],
  className,
  disabled = false,
  onSubmitAnswer,
  onBlockedAction,
}: AssessmentQuestionTurnProps) {
  const [showWhy, setShowWhy] = useState(false);

  const booleanChoices =
    question.choices && question.choices.length > 0
      ? question.choices
      : [
          { id: "yes", label: t("pages.assessment.booleanYes") },
          { id: "no", label: t("pages.assessment.booleanNo") },
        ];

  function handleSingleSelectChange(choiceId: string) {
    if (disabled) {
      return;
    }
    onSelectedChoiceIdsChange?.([choiceId]);
  }

  function handleMultiSelectChange(choiceIds: string[]) {
    if (disabled) {
      return;
    }
    onSelectedChoiceIdsChange?.(choiceIds);
  }

  return (
    <div
      data-slot="assessment-question-turn"
      data-control={question.control}
      data-intent={question.intent}
      className={cn("w-full max-w-170 space-y-3", className)}
    >
      {question.priorAnswerSummary && !answerHistoryVisible ? (
        <SelectionHistoryRow selectedValue={question.priorAnswerSummary} />
      ) : null}

      <div className="space-y-3">
        <p className="text-sm leading-6 text-foreground">{question.prompt}</p>

        {question.proposedInterpretation ? (
          <div
            data-slot="proposed-interpretation"
            className="rounded-lg border bg-muted/30 p-3.5 text-sm leading-6 text-foreground"
          >
            <p className="whitespace-pre-wrap">{question.proposedInterpretation}</p>
          </div>
        ) : null}

        {assessmentId && question.snippetRef && !historical ? (
          <QuestionSourceSnippet
            assessmentId={assessmentId}
            question={question}
          />
        ) : null}

        {question.whyEvidenceRefs && question.whyEvidenceRefs.length > 0 ? (
          <div data-slot="why-asking-disclosure" className="space-y-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((current) => !current)}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <HelpCircleIcon className="size-3.5" />
              {t("pages.assessment.whyAsking")}
            </Button>
            {showWhy ? (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {t("pages.assessment.whyAskingSafeNote")}
              </p>
            ) : null}
          </div>
        ) : null}

        {question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean ? (
          <ChatSingleSelect
            value={selectedChoiceIds[0]}
            disabled={disabled}
            onValueChange={handleSingleSelectChange}
            options={booleanChoices}
          />
        ) : null}

        {question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ? (
          <ChatSingleSelect
            value={selectedChoiceIds[0]}
            disabled={disabled}
            onValueChange={handleSingleSelectChange}
            options={question.choices ?? []}
          />
        ) : null}

        {question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect ? (
          <ChatMultiSelect
            values={selectedChoiceIds}
            disabled={disabled}
            onValuesChange={handleMultiSelectChange}
            options={question.choices ?? []}
          />
        ) : null}

        {isSelectionControl(question.control) &&
        !answerHistoryVisible &&
        !hideSubmitSelection ? (
          <div
            data-slot="selection-submit-action"
            className="flex flex-wrap items-center gap-2"
          >
            <Button
              type="button"
              size="sm"
              disabled={disabled || !canSubmitSelection}
              onClick={() => onSubmitSelection?.()}
            >
              <SendIcon />
              {t("pages.assessment.submitAnswer")}
            </Button>
          </div>
        ) : null}

        {question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust &&
        !historical ? (
          <div
            data-slot="confirm-adjust-actions"
            className="flex flex-wrap items-center gap-2"
          >
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onSubmitAnswer?.({
                  questionId: question.id,
                  confirmed: true,
                })
              }
            >
              <CheckIcon />
              {t("pages.assessment.confirm")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isAdjusting ? "secondary" : "outline"}
              disabled={disabled}
              onClick={() => onAdjust?.()}
            >
              <Edit3Icon />
              {t("pages.assessment.adjust")}
            </Button>
            {isAdjusting ? (
              <span className="text-xs text-muted-foreground">
                {t("pages.assessment.continueInComposer")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {blockedActions.length > 0 ? (
        <div
          data-slot="blocked-or-unresolved-actions"
          className="flex flex-wrap gap-2 pt-1"
        >
          {blockedActions.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={
                action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
                  ? "outline"
                  : "secondary"
              }
              onClick={() => onBlockedAction?.(action)}
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
      ) : null}
    </div>
  );
}

function QuestionSourceSnippet({
  assessmentId,
  question,
}: {
  assessmentId: string;
  question: AssessmentInterviewQuestion;
}) {
  const snippet = useAssessmentInterviewSourceSnippetQuery(
    assessmentId,
    question.id,
  );
  const ref = question.snippetRef!;

  return (
    <section
      data-slot="question-source-snippet"
      aria-label={t("pages.assessment.sourceCode")}
      className="overflow-hidden rounded-lg border bg-muted/30"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
        <Code2Icon className="size-3.5 shrink-0" />
        <span className="font-medium text-foreground">
          {t("pages.assessment.sourceCode")}
        </span>
        <span className="break-all font-mono">
          {ref.file_path}:{ref.start_line}-{ref.end_line}
        </span>
      </div>
      {snippet.isPending ? (
        <div className="space-y-2 p-3" aria-busy="true">
          <div className="h-3 w-4/5 animate-pulse rounded-sm bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded-sm bg-muted" />
          <span className="sr-only">
            {t("pages.assessment.sourceCodeLoading")}
          </span>
        </div>
      ) : snippet.data ? (
        <pre className="max-h-72 overflow-auto p-3 text-xs leading-5">
          <code>
            {snippet.data.lines.map((sourceLine) => (
              <span key={sourceLine.line} className="flex min-w-max">
                <span
                  aria-hidden="true"
                  className="w-10 shrink-0 select-none text-right text-muted-foreground"
                >
                  {sourceLine.line}
                </span>
                <span className="pl-4">{sourceLine.text || " "}</span>
              </span>
            ))}
          </code>
        </pre>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">
          {t("pages.assessment.sourceCodeUnavailable")}
        </p>
      )}
    </section>
  );
}

// Choosing an option only stages a draft. Without a submit control next to the choice
// the only way to send it is the composer's arrow, which sits in an empty text box and
// reads as inactive, so a selected answer looks submitted while nothing was sent.
function isSelectionControl(control: AssessmentInterviewQuestion["control"]) {
  return (
    control === ASSESSMENT_INTERVIEW_CONTROLS.boolean ||
    control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
    control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect
  );
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
