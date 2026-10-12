import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { ChatMessage } from "@/components/molecules/chat-message";
import { WorkDisclosure } from "@/components/molecules/work-disclosure";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import {
  WORK_STEP_STATUSES,
  type WorkTurn,
} from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";
import { formatDuration } from "../../utils/format-duration";
import { ConversationUsageLine } from "./conversation-usage-line";
import { ConversationTechnicalDetails } from "./conversation-technical-details";

/**
 * One assistant work turn: a compact disclosure that is open and animated only while the Root is
 * working, then collapses to "Worked for 18s". Technical details stay behind their own expander.
 */
export function ConversationWorkTurn({ turn }: { turn: WorkTurn }) {
  const active = turn.steps.find(
    (step) => step.status === WORK_STEP_STATUSES.ACTIVE,
  );
  const summary = turn.running
    ? copy("work.running")
    : turn.durationMs < 1000
      ? copy("work.workedBriefly")
      : copy("work.workedFor", { duration: formatDuration(turn.durationMs) });
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent}>
      <WorkDisclosure
        summary={summary}
        running={turn.running}
        meta={<ConversationUsageLine usage={turn.usage} />}
      >
        {turn.steps.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {turn.steps.map((step) => (
              <li
                key={step.kind}
                data-step-kind={step.kind}
                data-step-status={step.status}
                className="flex items-start gap-2 text-sm"
              >
                {step.status === WORK_STEP_STATUSES.ACTIVE ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="mt-1 size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                  />
                ) : (
                  <CheckIcon
                    aria-hidden="true"
                    className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1">
                  {step === active
                    ? copy(`work.activeSteps.${step.kind}`)
                    : copy(`work.steps.${step.kind}`)}
                  {step.count > 1 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ×{step.count}
                    </span>
                  ) : null}
                </span>
                <ConversationUsageLine usage={step.usage} />
              </li>
            ))}
          </ul>
        ) : null}
        <ConversationTechnicalDetails events={turn.technical} />
      </WorkDisclosure>
    </ChatMessage>
  );
}
