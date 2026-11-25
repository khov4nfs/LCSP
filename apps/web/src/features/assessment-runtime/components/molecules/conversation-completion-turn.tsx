import { useEffect } from "react";
import { toast } from "sonner";

import { ChatMessage } from "@/components/molecules/chat-message";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import { getAssessmentCompletionNotificationSnapshot } from "@/lib/general-preferences";
import type { CompletionTurn } from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";
import { AssessmentReportActions } from "./assessment-report-actions";

const notifiedAssessments = new Set<string>();

/** The terminal assistant message: what was evaluated and how to open or download the report. */
export function ConversationCompletionTurn({
  turn,
}: {
  turn: CompletionTurn;
}) {
  useEffect(() => {
    // Rationale (Why): Notify customer when a long-running assessment completes per user general preference.
    // Mechanism (How): Check client preference and deduplicate using persistent in-memory set to prevent duplicates on re-render.
    // Invariants (What): Safe in-app feedback without external push/email leaks; respects disabled preference.
    if (
      getAssessmentCompletionNotificationSnapshot() &&
      !notifiedAssessments.has(turn.assessmentId)
    ) {
      notifiedAssessments.add(turn.assessmentId);
      toast.info(copy("completion.title"), {
        description: copy("completion.evaluated", { count: turn.evaluated }),
      });
    }
  }, [turn.assessmentId, turn.evaluated]);

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
