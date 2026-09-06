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
  Edit3Icon,
  HelpCircleIcon,
  SaveIcon,
  TextCursorInputIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

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
  question: AssessmentInterviewQuestion;
  selectedChoiceIds?: string[];
  onSelectedChoiceIdsChange?: (choiceIds: string[]) => void;
  isAdjusting?: boolean;
  onAdjust?: () => void;
  blockedActions?: AssessmentInterviewBlockedAction[];
  className?: string;
  disabled?: boolean;
  onSubmitAnswer?: (input: AssessmentQuestionAnswerInput) => void;
  onBlockedAction?: (action: AssessmentInterviewBlockedAction) => void;
};

export function AssessmentQuestionTurn({
  question,
  selectedChoiceIds = [],
  onSelectedChoiceIdsChange,
  isAdjusting = false,
  onAdjust,
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
      {question.priorAnswerSummary ? (
        <SelectionHistoryRow
          prompt={question.prompt}
          selectedValue={question.priorAnswerSummary}
        />
      ) : null}

      <div className="space-y-3">
        <p className="text-sm leading-6 text-foreground">{question.prompt}</p>

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

        {question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust ? (
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

        {question.whyEvidenceRefs && question.whyEvidenceRefs.length > 0 ? (
          <div
            data-slot="why-asking-disclosure"
            className="space-y-2 pt-1"
          >
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
