import { ASSESSMENT_INTERVIEW_CONTROLS } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { CheckIcon, Edit3Icon } from "lucide-react";

import { appLocale } from "@/lib/locale";

import { ASSESSMENT_CHAT_ROLES } from "../../types/assessment-chat.types";
import type {
  InterviewCycleOutputProps,
  InterviewCycleTurnProps,
} from "../../types/interview-cycle-turn.types";
import { AgentMessage, AgentTurn } from "./agent-turn";
import { AssessmentQuestionTurn } from "./assessment-question-turn";
import { InterviewAnswerMessage } from "./interview-answer-message";
import { InterviewOutputPanel } from "./interview-output-panel";
import { TurnFooter } from "./turn-footer";

/** Question -> customer answer -> activity caused by that answer -> result.
 * The following cycle owns the next question, so it is rendered exactly once. */
export function InterviewCycleTurn(props: InterviewCycleTurnProps) {
  const answer = "cycle" in props ? props.cycle.answer : props.answer;
  const question = "cycle" in props ? props.cycle.question : answer.question;
  const activity = props.activity;
  const hasSelection = Boolean(
    answer.selectedChoiceIds?.length &&
    question &&
    (question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean),
  );
  const isConfirmAdjustQuestion =
    question?.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust;
  // A confirmAdjust answer only carries a comment when the customer chose to
  // adjust (the flow requires free text with "adjust", none with "confirm"),
  // so this is a reliable, structural signal — no need to parse the backend's
  // audit-log summary sentence to know which one happened.
  const wasAdjusted = Boolean(answer.comment?.trim());
  const agentTimestampFooter = (
    <TurnFooter timestamp={answer.answeredAt} className="justify-start" />
  );

  return (
    <div data-slot="interview-cycle-turn" className="space-y-6">
      {(hasSelection || isConfirmAdjustQuestion) && question ? (
        <AgentTurn footer={agentTimestampFooter}>
          <AssessmentQuestionTurn
            question={question}
            selectedChoiceIds={answer.selectedChoiceIds}
            answerHistoryVisible
            historical
            disabled
          />
        </AgentTurn>
      ) : answer.questionPrompt ? (
        <AgentTurn footer={agentTimestampFooter}>
          <AgentMessage>
            <p className="whitespace-pre-wrap wrap-break-word">
              {answer.questionPrompt}
            </p>
          </AgentMessage>
        </AgentTurn>
      ) : null}
      {isConfirmAdjustQuestion ? (
        <AgentTurn role={ASSESSMENT_CHAT_ROLES.user}>
          {wasAdjusted ? (
            <InterviewAnswerMessage text={answer.comment ?? ""} />
          ) : (
            <div data-slot="interview-customer-confirmation">
              <InterviewAnswerMessage
                text={t("pages.assessment.customerConfirmedAnswer")}
              />
            </div>
          )}
        </AgentTurn>
      ) : (
        <>
          {!hasSelection ? (
            <AgentTurn role={ASSESSMENT_CHAT_ROLES.user}>
              <InterviewAnswerMessage text={answer.summary} />
            </AgentTurn>
          ) : null}
          {answer.comment?.trim() ? (
            <AgentTurn role={ASSESSMENT_CHAT_ROLES.user}>
              <InterviewAnswerMessage text={answer.comment} />
            </AgentTurn>
          ) : null}
        </>
      )}
      {activity}
      {isConfirmAdjustQuestion && !props.activityOwnsOutput ? (
        <AgentTurn>
          <InterviewCycleOutput answer={answer} question={question} />
        </AgentTurn>
      ) : null}
    </div>
  );
}

/** The cycle's result card (confirmed or adjusted context), if it has one. */
export function InterviewCycleOutput({
  answer,
  question,
}: InterviewCycleOutputProps) {
  if (question?.control !== ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    return null;
  }
  const wasAdjusted = Boolean(answer.comment?.trim());
  return (
    <InterviewOutputPanel
      icon={wasAdjusted ? Edit3Icon : CheckIcon}
      label={
        wasAdjusted
          ? t("pages.assessment.adjustedContextOutput")
          : t("pages.assessment.confirmedContextOutput")
      }
    />
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
