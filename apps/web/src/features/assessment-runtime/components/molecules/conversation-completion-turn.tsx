import { ChatMessage } from "@/components/molecules/chat-message";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import type { CompletionTurn } from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";
import { AssessmentReportActions } from "./assessment-report-actions";

/** The terminal assistant message: what was evaluated and how to open or download the report. */
export function ConversationCompletionTurn({
  turn,
}: {
  turn: CompletionTurn;
}) {
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent} author={copy("agentName")}>
      <div data-slot="completion-turn" className="flex flex-col gap-2">
        <p className="font-medium">{copy("completion.title")}</p>
        <p className="text-muted-foreground">
          {[
            copy("completion.evaluated", { count: turn.evaluated }),
            copy("completion.compliant", { count: turn.compliant }),
            copy("completion.nonCompliant", { count: turn.nonCompliant }),
            ...(turn.notApplicable > 0
              ? [copy("completion.notApplicable", { count: turn.notApplicable })]
              : []),
          ].join(" · ")}
        </p>
        {turn.reportArtifactId ? (
          <AssessmentReportActions
            assessmentId={turn.assessmentId}
            artifactId={turn.reportArtifactId}
          />
        ) : null}
      </div>
    </ChatMessage>
  );
}
