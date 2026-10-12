import { ChatMessage } from "@/components/molecules/chat-message";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import type { AnswerTurn } from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";

/** The customer's accepted answer, kept in the thread so it reads coherently after a reload. */
export function ConversationAnswerTurn({ turn }: { turn: AnswerTurn }) {
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.user} author={copy("userName")}>
      <span data-answer-for={turn.requestId}>
        {turn.doesNotKnow || turn.answer === null
          ? copy("answer.unknown")
          : turn.answer}
      </span>
    </ChatMessage>
  );
}
