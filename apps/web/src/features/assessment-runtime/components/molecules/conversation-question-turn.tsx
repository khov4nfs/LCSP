import { HelpCircleIcon, CheckCircle2Icon } from "lucide-react";
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
  const titleId = `question-${request.requestId}`;
  const unknownRecorded =
    turn.open && request.answers.at(-1)?.doesNotKnow === true;
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent} author={copy("agentName")}>
      <div
        data-human-request={request.requestId}
        data-request-state={turn.open ? "OPEN" : "CLOSED"}
        tabIndex={-1}
        className="flex flex-col gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex items-center gap-2">
          {turn.open ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 border border-amber-500/20">
              <HelpCircleIcon className="size-3.5" aria-hidden="true" />
              {copy("question.clarificationNeeded")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
              <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
              {copy("question.confirmed")}
            </span>
          )}
        </div>
        <p id={titleId} className="text-sm font-medium leading-relaxed text-foreground whitespace-pre-wrap">
          {request.question}
        </p>
        {request.decisionImpact.length > 0 ||
        Boolean(request.unresolvedFact) ||
        request.resolutionAttempts.length > 0 ? (
          <details className="group rounded-lg border bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/40">
            <summary className="cursor-pointer list-none font-medium select-none text-foreground/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
              <span>{copy("question.whyAsking")}</span>
              <span className="text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="mt-2.5 space-y-1.5 pt-1.5 border-t border-border/40">
              {request.unresolvedFact ? (
                <div>
                  <span className="font-semibold text-foreground">{copy("question.unresolvedFactLabel")}</span>{" "}
                  <span>{request.unresolvedFact}</span>
                </div>
              ) : null}
              {request.decisionImpact.length > 0 ? (
                <div>
                  <span className="font-semibold text-foreground">{copy("question.decisionImpactLabel")}</span>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {request.decisionImpact.map((impact) => (
                      <li key={impact}>{impact}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {request.resolutionAttempts.length > 0 ? (
                <div>
                  <span className="font-semibold text-foreground">{copy("question.resolutionAttemptsLabel")}</span>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {request.resolutionAttempts.map((attempt) => (
                      <li key={attempt}>{attempt}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
        {turn.open ? (
          <div aria-labelledby={titleId} role="group" className="pt-1">
            <StructuredAnswerControl
              mode={structuredAnswerMode(request)}
              choices={request.choices}
              idBase={`answer-${request.requestId}`}
              pending={pending}
              failed={failed}
              staleConflict={staleConflict}
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
