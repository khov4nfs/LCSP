import type { ReactNode } from "react";
import { AssessmentTranscript } from "@/features/workspace/components/organisms/assessment-transcript";
import {
  CONVERSATION_TURN_KINDS,
  type ConversationProjection,
  type ConversationTurn,
} from "../../types/conversation.types";
import type { StructuredAnswer } from "../../types/structured-answer.types";
import { ConversationAnswerTurn } from "../molecules/conversation-answer-turn";
import { ConversationCompletionTurn } from "../molecules/conversation-completion-turn";
import { ConversationDecisionTurn } from "../molecules/conversation-decision-turn";
import { ConversationNoticeTurn } from "../molecules/conversation-notice-turn";
import { ConversationOpeningTurn } from "../molecules/conversation-opening-turn";
import { ConversationQuestionTurn } from "../molecules/conversation-question-turn";
import type { AssessmentHumanRequestView } from "@lcsp/contracts/assessment-domain";
import { ConversationWorkTurn } from "../molecules/conversation-work-turn";
import { copy } from "../../utils/conversation-copy";

type AssessmentConversationProps = {
  projection: ConversationProjection;
  answerPending: boolean;
  answerFailed: boolean;
  onAnswer: (
    answer: StructuredAnswer,
    request: AssessmentHumanRequestView,
  ) => void;
  submittingRequestId?: string | null;
  failedRequestId?: string | null;
  /** Rendered after the last turn inside the scroll area (e.g. a load error). */
  footer?: ReactNode;
  targetRequestId?: string;
};

/**
 * THE conversation: the single chronological authority of an assessment. Every user-visible
 * activity, question, answer, decision and completion renders here, exactly once, from the one
 * projection; no other surface renders the timeline.
 */
export function AssessmentConversation({
  projection,
  answerPending,
  answerFailed,
  onAnswer,
  submittingRequestId,
  failedRequestId,
  footer,
  targetRequestId,
}: AssessmentConversationProps) {
  return (
    <AssessmentTranscript
      ariaLabel={copy("transcriptLabel")}
      autoScrollKey={targetRequestId ? undefined : projection.followKey}
      live="off"
    >
      {projection.turns.map((turn) => (
        <div key={turn.id} data-turn-kind={turn.kind}>
          {renderTurn(turn, {
            answerPending,
            answerFailed,
            submittingRequestId,
            failedRequestId,
            onAnswer,
          })}
        </div>
      ))}
      {footer}
    </AssessmentTranscript>
  );
}

function renderTurn(
  turn: ConversationTurn,
  context: {
    answerPending: boolean;
    answerFailed: boolean;
    submittingRequestId?: string | null;
    failedRequestId?: string | null;
    onAnswer: (
      answer: StructuredAnswer,
      request: AssessmentHumanRequestView,
    ) => void;
  },
) {
  switch (turn.kind) {
    case CONVERSATION_TURN_KINDS.OPENING:
      return <ConversationOpeningTurn turn={turn} />;
    case CONVERSATION_TURN_KINDS.WORK:
      return <ConversationWorkTurn turn={turn} />;
    case CONVERSATION_TURN_KINDS.QUESTION:
      return (
        <ConversationQuestionTurn
          turn={turn}
          pending={
            context.submittingRequestId
              ? context.submittingRequestId === turn.request.requestId
              : context.answerPending
          }
          failed={
            context.failedRequestId
              ? context.failedRequestId === turn.request.requestId
              : context.answerFailed
          }
          onAnswer={(answer) => context.onAnswer(answer, turn.request)}
        />
      );
    case CONVERSATION_TURN_KINDS.ANSWER:
      return <ConversationAnswerTurn turn={turn} />;
    case CONVERSATION_TURN_KINDS.DECISION:
      return <ConversationDecisionTurn turn={turn} />;
    case CONVERSATION_TURN_KINDS.NOTICE:
      return <ConversationNoticeTurn turn={turn} />;
    case CONVERSATION_TURN_KINDS.COMPLETION:
      return <ConversationCompletionTurn turn={turn} />;
  }
}
