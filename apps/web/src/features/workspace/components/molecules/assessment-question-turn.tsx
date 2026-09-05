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
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import { ChatSingleSelect } from "./chat-single-select";
import { SelectionHistoryRow } from "./selection-history-row";

type AssessmentQuestionTurnProps = {
  question: AssessmentInterviewQuestion;
  blockedActions?: AssessmentInterviewBlockedAction[];
  className?: string;
  disabled?: boolean;
  initialDraft?: string;
  onDraftChange?: (value: string) => void;
  onSubmitAnswer?: (input: AssessmentQuestionAnswerInput) => void;
  onBlockedAction?: (action: AssessmentInterviewBlockedAction) => void;
};

export type AssessmentQuestionAnswerInput = {
  questionId: string;
  freeText?: string;
  selectedChoiceIds?: string[];
  otherText?: string;
  confirmed?: boolean;
  adjusted?: boolean;
};

export function AssessmentQuestionTurn({
  question,
  blockedActions = [],
  className,
  disabled = false,
  initialDraft = "",
  onDraftChange,
  onSubmitAnswer,
  onBlockedAction,
}: AssessmentQuestionTurnProps) {
  const [freeText, setFreeText] = useState(initialDraft);
  const [singleValue, setSingleValue] = useState<string>();
  const [multiValues, setMultiValues] = useState<Set<string>>(() => new Set());
  const [otherText, setOtherText] = useState("");
  const [showWhy, setShowWhy] = useState(false);

  const selectedChoiceIds = useMemo(() => Array.from(multiValues), [multiValues]);
  const selectedChoiceRequiresText = (question.choices ?? []).some(
    (choice) =>
      choice.requiresFreeText &&
      (choice.id === singleValue || multiValues.has(choice.id)),
  );

  function updateFreeText(value: string) {
    if (disabled) {
      return;
    }
    setFreeText(value);
    onDraftChange?.(value);
  }

  function toggleMultiValue(value: string) {
    if (disabled) {
      return;
    }
    setMultiValues((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  function submitAnswer(input: Partial<AssessmentQuestionAnswerInput> = {}) {
    if (disabled) {
      return;
    }
    const usesSingleValue =
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean;
    onSubmitAnswer?.({
      questionId: question.id,
      freeText: freeText.trim() || undefined,
      selectedChoiceIds:
        usesSingleValue && singleValue ? [singleValue] : selectedChoiceIds,
      otherText: otherText.trim() || undefined,
      ...input,
    });
  }

  return (
    <section
      data-slot="assessment-question-turn"
      data-control={question.control}
      data-intent={question.intent}
      className={cn("space-y-3", className)}
    >
      {question.priorAnswerSummary ? (
        <SelectionHistoryRow
          prompt={question.prompt}
          selectedValue={question.priorAnswerSummary}
        />
      ) : null}

      <div className="rounded-xl border border-border/70 bg-card p-4">
        <p className="text-sm leading-6 text-foreground">{question.prompt}</p>

        <div className="mt-3">
          {question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText ? (
            <Textarea
              aria-label={question.prompt}
              className="min-h-24 resize-y"
              disabled={disabled}
              placeholder={t("pages.appShell.chatComposerPlaceholder")}
              value={freeText}
              onChange={(event) => updateFreeText(event.target.value)}
            />
          ) : null}

          {question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean ? (
            <ChatSingleSelect
              value={singleValue}
              disabled={disabled}
              onValueChange={setSingleValue}
              options={[
                { id: "yes", label: t("pages.assessment.booleanYes") },
                { id: "no", label: t("pages.assessment.booleanNo") },
              ]}
            />
          ) : null}

          {question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ? (
            <ChatSingleSelect
              value={singleValue}
              disabled={disabled}
              onValueChange={setSingleValue}
              options={question.choices ?? []}
            />
          ) : null}

          {question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect ? (
            <div className="grid gap-2" data-slot="chat-multi-select">
              {(question.choices ?? []).map((choice) => {
                const selected = multiValues.has(choice.id);
                return (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => toggleMultiValue(choice.id)}
                    className={cn(
                      "flex min-w-0 items-start gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                      selected
                        ? "border-foreground/20 bg-muted/80"
                        : "border-border/70 bg-background hover:bg-muted/50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {choice.label}
                      </span>
                      {choice.description ? (
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {choice.description}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <CheckIcon className="mt-0.5 size-4 shrink-0" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => submitAnswer({ confirmed: true })}
              >
                <CheckIcon />
                {t("pages.assessment.confirm")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => submitAnswer({ adjusted: true })}
              >
                <Edit3Icon />
                {t("pages.assessment.adjust")}
              </Button>
            </div>
          ) : null}

          {selectedChoiceRequiresText ? (
            <Textarea
              aria-label={t("pages.assessment.otherDescribe")}
              className="mt-3 min-h-20"
              disabled={disabled}
              placeholder={t("pages.assessment.otherDescribe")}
              value={otherText}
              onChange={(event) => setOtherText(event.target.value)}
            />
          ) : null}
        </div>

        {question.control !== ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust ? (
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={disabled}
            onClick={() => submitAnswer()}
          >
            <CheckIcon />
            {t("pages.assessment.submitAnswer")}
          </Button>
        ) : null}

        {question.whyEvidenceRefs && question.whyEvidenceRefs.length > 0 ? (
          <div className="mt-3 space-y-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((current) => !current)}
            >
              <HelpCircleIcon />
              {t("pages.assessment.whyAsking")}
            </Button>
            {showWhy ? (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {t("pages.assessment.whyAskingDetail")} {question.whyEvidenceRefs.join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {blockedActions.length > 0 ? (
        <div
          data-slot="blocked-or-unresolved-actions"
          className="flex flex-wrap gap-2"
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
    </section>
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
