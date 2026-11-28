import { ChatMessage } from "@/components/molecules/chat-message";
import { RequestDetail } from "@/components/molecules/request-detail";
import { ResponseForm } from "@/components/molecules/response-form";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import type {
  QuestionTurn,
} from "../../types/conversation.types";
import type { StructuredAnswer } from "../../types/structured-answer.types";
import { STRUCTURED_ANSWER_MODES } from "../../types/structured-answer.types";
import { copy } from "../../utils/conversation-copy";
import { structuredAnswerMode } from "../../utils/structured-answer-mode";
import { StructuredAnswerControl } from "./structured-answer-control";

type QuestionTurnProps = {
  turn: QuestionTurn;
  pending: boolean;
  failed: boolean;
  staleConflict?: boolean;
  onAnswer: (answer: StructuredAnswer) => void;
};

/**
 * A human-resolution request as an assistant question. While it is OPEN the answer control sits
 * right under it; afterwards it is plain history followed by the customer's own answer turn.
 */
export function ConversationQuestionTurn({
  turn,
  pending,
  failed,
  staleConflict,
  onAnswer,
}: QuestionTurnProps) {
  const { request } = turn;
  const mode = structuredAnswerMode(request);
  const titleId = `question-${request.requestId}`;
  const unknownRecorded =
    turn.open && request.answers.at(-1)?.doesNotKnow === true;
  const typeLabelKey =
    mode === STRUCTURED_ANSWER_MODES.BOOLEAN
      ? "answer.typeBoolean"
      : mode === STRUCTURED_ANSWER_MODES.MULTI_CHOICE
        ? "answer.typeMulti"
        : mode === STRUCTURED_ANSWER_MODES.CHOICE
          ? "answer.typeSingle"
          : "answer.typeText";
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent} author={copy("agentName")}>
      <div
        data-human-request={request.requestId}
        data-request-state={turn.open ? "OPEN" : "CLOSED"}
        tabIndex={-1}
        className="flex flex-col gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <p className="text-xs font-medium text-muted-foreground">
          {copy(typeLabelKey)}
        </p>
        <RequestDetail
          titleId={titleId}
          question={request.question}
          open={turn.open}
          statusLabelOverride={
            turn.open
              ? copy("question.clarificationNeeded")
              : copy("question.confirmed")
          }
          unresolvedFact={request.unresolvedFact}
          decisionImpact={request.decisionImpact}
          resolutionAttempts={request.resolutionAttempts}
          whyAskingLabel={copy("question.whyAsking")}
          unresolvedFactLabel={copy("question.unresolvedFactLabel")}
          decisionImpactLabel={copy("question.decisionImpactLabel")}
          resolutionAttemptsLabel={copy("question.resolutionAttemptsLabel")}
          defaultExpanded={turn.open}
        />
        {turn.open ? (
          <div aria-labelledby={titleId} role="group" className="pt-1">
            <ResponseForm failed={failed} staleConflict={staleConflict}>
              <StructuredAnswerControl
                mode={mode}
                choices={request.choices}
                idBase={`answer-${request.requestId}`}
                pending={pending}
                failed={failed}
                staleConflict={staleConflict}
                onSubmit={onAnswer}
              />
            </ResponseForm>
          </div>
        ) : null}
        {unknownRecorded ? (
          <p className="text-xs text-muted-foreground">
            {copy("question.unknownRecorded")}
          </p>
        ) : null}
      </div>
    </ChatMessage>
  );
}
