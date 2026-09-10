import { ASSESSMENT_INTERVIEW_CONTROLS } from "@lcsp/contracts/evidence";

import { ASSESSMENT_CHAT_ROLES } from "../../types/assessment-chat.types";
import type { InterviewAnswerHistoryProps } from "../../types/interview-answer-history.types";
import { AgentMessage, AgentTurn } from "./agent-turn";
import { AssessmentQuestionTurn } from "./assessment-question-turn";
import { InterviewAnswerMessage } from "./interview-answer-message";

export function InterviewAnswerHistory({
  answer,
}: InterviewAnswerHistoryProps) {
  const question = answer.question;
  const hasSelection = Boolean(
    answer.selectedChoiceIds?.length &&
    question &&
    (question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean),
  );

  return (
    <div className="space-y-6">
      {hasSelection && question ? (
        <AgentTurn>
          <AssessmentQuestionTurn
            question={question}
            selectedChoiceIds={answer.selectedChoiceIds}
            answerHistoryVisible
            disabled
          />
        </AgentTurn>
      ) : (
        <>
          {answer.questionPrompt ? (
            <AgentTurn>
              <AgentMessage>
                <p className="whitespace-pre-wrap wrap-break-word">
                  {answer.questionPrompt}
                </p>
              </AgentMessage>
            </AgentTurn>
          ) : null}
          <AgentTurn role={ASSESSMENT_CHAT_ROLES.user}>
            <InterviewAnswerMessage text={answer.summary} />
          </AgentTurn>
        </>
      )}
      {answer.comment?.trim() ? (
        <AgentTurn role={ASSESSMENT_CHAT_ROLES.user}>
          <InterviewAnswerMessage text={answer.comment} />
        </AgentTurn>
      ) : null}
    </div>
  );
}
