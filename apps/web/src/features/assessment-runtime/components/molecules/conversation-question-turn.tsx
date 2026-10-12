import { ChatMessage } from "@/components/molecules/chat-message";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import type {
  QuestionTurn,
} from "../../types/conversation.types";
import type { StructuredAnswer } from "../../types/structured-answer.types";
import { copy } from "../../utils/conversation-copy";
import { structuredAnswerMode } from "../../utils/structured-answer-mode";
import { StructuredAnswerControl } from "./structured-answer-control";

type QuestionTurnProps = {
  turn: QuestionTurn;
  pending: boolean;
  failed: boolean;
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
  onAnswer,
}: QuestionTurnProps) {
  const { request } = turn;
  const titleId = `question-${request.requestId}`;
  const unknownRecorded =
    turn.open && request.answers.at(-1)?.doesNotKnow === true;
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent} author={copy("agentName")}>
      <div
        data-human-request={request.requestId}
        data-request-state={turn.open ? "OPEN" : "CLOSED"}
        className="flex flex-col gap-3"
      >
        <p id={titleId} className="font-medium whitespace-pre-wrap">
          {request.question}
        </p>
        {request.decisionImpact.length > 0 ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none rounded-md select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              {copy("question.whyAsking")}
            </summary>
            <ul className="mt-1 list-disc pl-5">
              {request.decisionImpact.map((impact) => (
                <li key={impact}>{impact}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {turn.open ? (
          <div aria-labelledby={titleId} role="group">
            <StructuredAnswerControl
              mode={structuredAnswerMode(request)}
              choices={request.choices}
              idBase={`answer-${request.requestId}`}
              pending={pending}
              failed={failed}
              onSubmit={onAnswer}
            />
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
