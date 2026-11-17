import { RULE_DECISION_APPLICABILITIES } from "@lcsp/contracts/assessment";
import { ChatMessage } from "@/components/molecules/chat-message";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import type { DecisionTurn } from "../../types/conversation.types";
import { LegalRuleOutput } from "../organisms/legal-rule-output";

/**
 * An accepted applicable rule decision rendered as an independent Enterprise LegalTech output message.
 * Non-applicable decisions are filtered out so that only applicable rules appear in the chat stream.
 */
export function ConversationDecisionTurn({ turn }: { turn: DecisionTurn }) {
  if (
    turn.record.decision.applicability !==
    RULE_DECISION_APPLICABILITIES.APPLICABLE
  ) {
    return null;
  }

  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent}>
      <LegalRuleOutput turn={turn} />
    </ChatMessage>
  );
}
