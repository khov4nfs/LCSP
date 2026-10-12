import { ChatMessage } from "@/components/molecules/chat-message";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import type { OpeningTurn } from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";

export function ConversationOpeningTurn({ turn }: { turn: OpeningTurn }) {
  const commit = turn.commit?.slice(0, 7) ?? null;
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent} author={copy("agentName")}>
      <p>{copy("opening")}</p>
      {turn.repositoryFullName && commit ? (
        <p className="mt-1 text-muted-foreground">
          {copy("openingRepository", {
            repository: turn.repositoryFullName,
            commit,
          })}
        </p>
      ) : null}
      {turn.ruleSetVersion ? (
        <p className="text-muted-foreground">
          {copy("openingRuleSet", { version: turn.ruleSetVersion })}
        </p>
      ) : null}
    </ChatMessage>
  );
}
