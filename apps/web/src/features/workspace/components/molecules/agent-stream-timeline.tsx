import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { WorkspaceRuntimeAgentStreamHistoryState } from "../../types/workspace-runtime.types";
import { AgentMessage, AgentTurn } from "./agent-turn";

type AgentStreamTimelineProps = {
  events: AssessmentAgentStreamEvent[];
  history?: WorkspaceRuntimeAgentStreamHistoryState;
  onLoadOlder?: () => void;
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
  history,
  onLoadOlder,
  className,
}: AgentStreamTimelineProps) {
  const rows = projectStreamRows(events);
  const labels = streamLabels();
  const showHistoryAction =
    ((history?.hasMore === true && history.nextCursor !== null) ||
      history?.error != null) &&
    onLoadOlder !== undefined;
  if (rows.length === 0 && !showHistoryAction) return null;

  return (
    <AgentTurn className={className}>
      <AgentMessage>
        <div data-slot="agent-stream-timeline" className="space-y-2">
          {showHistoryAction ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={history?.isLoading === true}
              onClick={onLoadOlder}
            >
              {history?.isLoading === true
                ? labels.loadingOlder
                : history?.error != null
                  ? labels.retryHistory
                  : labels.loadOlder}
            </Button>
          ) : null}
          {history?.error ? (
            <div className="text-xs text-destructive">
              {labels.historyLoadFailed}
            </div>
          ) : null}
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
                  <div className="whitespace-pre-wrap break-words wrap-anywhere text-foreground">
                    {row.detail}
                  </div>
                ) : null}
                {row.meta ? (
                  <div className="break-words wrap-anywhere text-[11px] text-muted-foreground">
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
  const semantic = semanticData(event.data);
  if (semantic) {
    return row(
      event,
      `${semanticLabel(semantic, labels)} · ${semanticName(event, semantic, name)}`,
      semanticDetail(semantic) ?? event.text,
      semanticMeta(event, semantic),
      event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed ||
        semantic.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
    );
  }

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
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.scannerActivity:
      return row(event, `${labels.scanner} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.engineeringRule:
      return row(event, `${labels.engineeringRule} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.skillUsage:
      return row(event, `${labels.skill} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.ruleProvenance:
      return row(event, `${labels.provenance} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult:
      return row(event, `${labels.model} · ${name}`, event.text, eventData(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolResult:
      return row(event, `${labels.toolCall} · ${event.toolName ?? name}`, event.text, eventData(event));
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

type SemanticRecord = Record<string, AssessmentRuntimeSummaryValue>;

function semanticData(
  value: AssessmentRuntimeSummaryValue | null,
): SemanticRecord | null {
  if (!isSummaryRecord(value)) return null;
  if (
    value.schemaVersion !==
      ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1 ||
    typeof value.kind !== "string"
  ) {
    return null;
  }
  return value;
}

function semanticLabel(
  semantic: SemanticRecord,
  labels: ReturnType<typeof streamLabels>,
): string {
  switch (semantic.kind) {
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerFile:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerSymbol:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerDependency:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerTraceStep:
      return labels.scanner;
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.engineeringRule:
      return labels.engineeringRule;
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.skillUsage:
      return labels.skill;
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.ruleProvenance:
      return labels.provenance;
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelRequest:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelOutput:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary:
      return labels.model;
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall:
      return labels.toolCall;
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult:
      return labels.toolOutput;
    default:
      return labels.runtime;
  }
}

function semanticName(
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord,
  fallback: string,
): string {
  return firstString(
    semantic.toolName,
    semantic.skillName,
    semantic.engineeringRuleId,
    semantic.dependencyName,
    semantic.functionName,
    semantic.filePath,
    semantic.model,
    event.toolName,
    event.nodeName,
    fallback,
  );
}

function semanticDetail(semantic: SemanticRecord): string | null {
  const refs = [
    semantic.filePath,
    semantic.functionName,
    semantic.symbolRef,
    semantic.dependencyName,
    semantic.traceId,
    semantic.edgeType,
    semantic.fromRef,
    semantic.toRef,
    semantic.concept,
    semantic.decision,
    semantic.reasonCode,
    semantic.evaluationStatus,
    semantic.provider,
    semantic.model,
    semantic.goalSummary,
    semantic.status,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const structured = semanticDisplayFields(semantic, [
    "parameters",
    "resultSummary",
    "availableToolNames",
    "inputArtifactRefs",
    "outputRefs",
    "usage",
    "finishReason",
    "skillVersionOrHash",
    "promptVersion",
  ]);
  const detail = [...refs, ...structured];
  return detail.length > 0 ? detail.join("\n") : null;
}

function semanticMeta(
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord,
): string | null {
  const correlation = [
    event.namespace.length > 0 ? event.namespace.join(" › ") : null,
    event.nodeName,
    event.messageId,
    event.toolCallId,
    semantic.durability,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  return correlation.length > 0 ? correlation.join(" · ") : eventMeta(event);
}

function isSummaryRecord(
  value: AssessmentRuntimeSummaryValue | null,
): value is SemanticRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(
  ...values: Array<AssessmentRuntimeSummaryValue | string | null | undefined>
): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "runtime";
}

function semanticDisplayFields(
  semantic: SemanticRecord,
  keys: string[],
): string[] {
  return keys.flatMap((key) => {
    const value = semantic[key];
    if (value === undefined || value === null || value === "") return [];
    if (Array.isArray(value) && value.length === 0) return [];
    return [`${humanizeSemanticKey(key)}: ${formatSemanticValue(value)}`];
  });
}

function formatSemanticValue(value: AssessmentRuntimeSummaryValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatSemanticValue(item)).join(", ");
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function humanizeSemanticKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
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
    scanner: t("pages.appShell.agentStreamLabels.scanner"),
    engineeringRule: t("pages.appShell.agentStreamLabels.engineeringRule"),
    skill: t("pages.appShell.agentStreamLabels.skill"),
    model: t("pages.appShell.agentStreamLabels.model"),
    provenance: t("pages.appShell.agentStreamLabels.provenance"),
    selected: t("pages.appShell.agentStreamSelected"),
    loadOlder: t("pages.appShell.agentStreamLoadOlder"),
    loadingOlder: t("pages.appShell.agentStreamLoadingOlder"),
    retryHistory: t("pages.appShell.agentStreamRetryHistory"),
    historyLoadFailed: t("pages.appShell.agentStreamHistoryLoadFailed"),
    running: t("pages.appShell.chatActivityStatuses.running"),
    completed: t("pages.appShell.chatActivityStatuses.completed"),
    failed: t("pages.appShell.chatActivityStatuses.failed"),
  };
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
