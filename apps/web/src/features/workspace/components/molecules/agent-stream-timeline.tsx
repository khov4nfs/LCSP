import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import { AgentMessage, AgentTurn } from "./agent-turn";

type AgentStreamTimelineProps = {
  events: AssessmentAgentStreamEvent[];
  className?: string;
};

type ProjectedStreamRow = {
  id: string;
  sequence: number;
  label: string;
  detail: string | null;
  meta: string | null;
  failed: boolean;
};

export function AgentStreamTimeline({
  events,
  className,
}: AgentStreamTimelineProps) {
  const rows = projectStreamRows(events);
  if (rows.length === 0) return null;

  return (
    <AgentTurn className={className}>
      <AgentMessage>
        <div data-slot="agent-stream-timeline" className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              data-stream-sequence={row.sequence}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-xs leading-5"
            >
              <span
                className={cn(
                  "font-medium text-muted-foreground",
                  row.failed && "text-destructive",
                )}
              >
                {row.label}
              </span>
              <div className="min-w-0">
                {row.detail ? (
                  <div className="whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere]">
                    {row.detail}
                  </div>
                ) : null}
                {row.meta ? (
                  <div className="break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    {row.meta}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </AgentMessage>
    </AgentTurn>
  );
}

function projectStreamRows(
  events: AssessmentAgentStreamEvent[],
): ProjectedStreamRow[] {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const rows: ProjectedStreamRow[] = [];
  let previousMergeKey: string | null = null;

  for (const event of ordered) {
    const mergeKey = deltaMergeKey(event);
    const previous = rows.at(-1);
    if (mergeKey && previous && previousMergeKey === mergeKey) {
      previous.detail = `${previous.detail ?? ""}${event.text ?? ""}`;
      previous.sequence = event.sequence;
      continue;
    }
    rows.push(toStreamRow(event));
    previousMergeKey = mergeKey;
  }

  return rows;
}

function deltaMergeKey(event: AssessmentAgentStreamEvent): string | null {
  if (
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta &&
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta &&
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolCallDelta
  ) {
    return null;
  }
  return [
    event.runId,
    event.eventType,
    event.agentName ?? "",
    event.messageId ?? "",
    event.toolCallId ?? "",
    event.namespace.join("/"),
  ].join(":");
}

function toStreamRow(event: AssessmentAgentStreamEvent): ProjectedStreamRow {
  const name =
    event.subagentName ??
    event.agentName ??
    event.toolName ??
    event.nodeName ??
    event.source ??
    "runtime";
  const labels = streamLabels();

  switch (event.eventType) {
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.subagentSelected:
      return row(event, `${labels.subagent} · ${name}`, labels.selected, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentStarted:
      return row(event, `${labels.agent} · ${name}`, labels.running, eventMeta(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted:
      return row(event, `${labels.agent} · ${name}`, labels.completed, eventMeta(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed:
      return row(event, `${labels.agent} · ${name}`, event.text ?? labels.failed, eventMeta(event), true);
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted:
      return row(event, `${labels.flow} · ${name}`, labels.running, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted:
      return row(event, `${labels.flow} · ${name}`, labels.completed, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed:
      return row(event, `${labels.flow} · ${name}`, event.text ?? labels.failed, eventData(event), true);
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta:
      return row(event, `${labels.reasoning} · ${name}`, event.text, eventMeta(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta:
      return row(event, `${labels.output} · ${name}`, event.text, eventMeta(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolCallDelta:
      return row(
        event,
        `${labels.toolCall} · ${event.toolName ?? name}`,
        event.text,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolResult:
      return row(
        event,
        `${labels.toolOutput} · ${event.toolName ?? name}`,
        event.text,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.log:
      return row(event, `${labels.log} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeEvent:
      return row(
        event,
        `${labels.runtime} · ${event.toolName ?? name}`,
        event.text,
        eventData(event),
        event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress:
      return row(event, `${labels.progress} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphUpdate:
      return row(event, `${labels.update} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphState:
      return row(event, `${labels.state} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.providerFallback:
      return row(event, `${labels.provider} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.credentialRotation:
      return row(event, `${labels.credential} · ${name}`, event.text, eventData(event));
    default:
      return row(event, event.eventType, event.text, eventData(event));
  }
}

function row(
  event: AssessmentAgentStreamEvent,
  label: string,
  detail: string | null,
  meta: string | null,
  failed = false,
): ProjectedStreamRow {
  return {
    id: event.eventId,
    sequence: event.sequence,
    label,
    detail,
    meta,
    failed,
  };
}

function eventMeta(event: AssessmentAgentStreamEvent): string | null {
  const parts = [
    event.namespace.length > 0 ? event.namespace.join(" › ") : null,
    event.nodeName,
    event.status,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function eventData(event: AssessmentAgentStreamEvent): string | null {
  if (event.data === null) return eventMeta(event);
  const serialized = JSON.stringify(event.data);
  const meta = eventMeta(event);
  return [meta, serialized].filter(Boolean).join(" · ") || null;
}

function streamLabels() {
  return {
    subagent: t("pages.appShell.agentStreamLabels.subagent"),
    agent: t("pages.appShell.agentStreamLabels.agent"),
    flow: t("pages.appShell.agentStreamLabels.flow"),
    reasoning: t("pages.appShell.agentStreamLabels.reasoning"),
    output: t("pages.appShell.agentStreamLabels.output"),
    toolCall: t("pages.appShell.agentStreamLabels.toolCall"),
    toolOutput: t("pages.appShell.agentStreamLabels.toolOutput"),
    log: t("pages.appShell.agentStreamLabels.log"),
    runtime: t("pages.appShell.agentStreamLabels.runtime"),
    progress: t("pages.appShell.agentStreamLabels.progress"),
    update: t("pages.appShell.agentStreamLabels.update"),
    state: t("pages.appShell.agentStreamLabels.state"),
    provider: t("pages.appShell.agentStreamLabels.provider"),
    credential: t("pages.appShell.agentStreamLabels.credential"),
    selected: t("pages.appShell.agentStreamSelected"),
    running: t("pages.appShell.chatActivityStatuses.running"),
    completed: t("pages.appShell.chatActivityStatuses.completed"),
    failed: t("pages.appShell.chatActivityStatuses.failed"),
  };
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
