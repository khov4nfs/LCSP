import type { TechnicalEvent } from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";

/**
 * Per-turn "Technical details": event types, tool and execution identifiers and per-invocation
 * usage. Collapsed by default and local to the turn, never a global feed.
 */
export function ConversationTechnicalDetails({
  events,
}: {
  events: readonly TechnicalEvent[];
}) {
  return (
    <details
      data-slot="technical-details"
      className="group/technical text-xs text-muted-foreground"
    >
      <summary className="cursor-pointer list-none rounded-md py-0.5 select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {copy("work.technicalDetails")} ·{" "}
        {copy("work.technicalEvents", { count: events.length })}
      </summary>
      {events.length === 0 ? (
        <p className="mt-1">{copy("work.technicalNoEvents")}</p>
      ) : (
        <ol className="mt-1 flex max-h-72 flex-col gap-1 overflow-auto font-mono text-[11px] leading-4">
          {events.map((event) => (
            <li key={event.eventId} className="break-words">
              <span>
                #{event.sequence} {event.eventType}
              </span>
              {event.labelKey ? <span> · {event.labelKey}</span> : null}
              {event.toolCallId ? (
                <span>
                  {" "}
                  · {copy("work.technicalTool")} {event.toolCallId}
                </span>
              ) : null}
              {event.taskId ? (
                <span>
                  {" "}
                  · {copy("work.technicalTask")} {event.taskId}
                </span>
              ) : null}
              {event.executionId ? (
                <span>
                  {" "}
                  · {copy("work.technicalExecution")} {event.executionId}
                </span>
              ) : null}
              {event.invocationId ? (
                <span>
                  {" "}
                  · {copy("work.technicalInvocation")} {event.invocationId}
                  {event.usage
                    ? ` · ${event.usage.inputTokens}/${event.usage.outputTokens}/${event.usage.totalTokens}`
                    : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
