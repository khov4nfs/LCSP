import { cn } from "@/lib/utils";
import {
  CONVERSATION_NOTICE_KINDS,
  type NoticeTurn,
} from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";

const NOTICE_COPY = {
  [CONVERSATION_NOTICE_KINDS.PAUSED]: "notice.paused",
  [CONVERSATION_NOTICE_KINDS.RESUMED]: "notice.resumed",
  [CONVERSATION_NOTICE_KINDS.FINALIZING]: "notice.finalizing",
  [CONVERSATION_NOTICE_KINDS.BLOCKED]: "notice.blocked",
  [CONVERSATION_NOTICE_KINDS.FAILED]: "notice.failed",
} as const;

/** A quiet runtime note between messages (paused, resumed, blocked); never a card. */
export function ConversationNoticeTurn({ turn }: { turn: NoticeTurn }) {
  const failed = turn.notice === CONVERSATION_NOTICE_KINDS.FAILED;
  return (
    <p
      data-slot="conversation-notice"
      data-notice={turn.notice}
      className={cn(
        "text-center text-xs text-muted-foreground",
        failed && "text-destructive",
      )}
    >
      {copy(NOTICE_COPY[turn.notice])}
      {turn.blockerReason
        ? ` ${copy(`notice.blockedReasons.${turn.blockerReason}`)}`
        : ""}
    </p>
  );
}
