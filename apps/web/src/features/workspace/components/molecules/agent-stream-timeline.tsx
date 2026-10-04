import {
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";

import {
  Brain,
  CheckCircle2,
  ChevronDown,
  Circle,
  LoaderCircle,
  PauseCircle,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

import { AGENT_STREAM_ACTIVITY_ICONS } from "../../config/agent-stream-activity-icons";

import { AGENT_STREAM_SEGMENT_KINDS } from "../../types/agent-stream-rule.types";

import type { WorkspaceRuntimeAgentStreamHistoryState } from "../../types/workspace-runtime.types";

import {
  projectAgentStreamRuleHeaders,
  segmentAgentStreamRowsByRule,
} from "../../utils/agent-stream-rule-groups";

import { AgentStreamRuleGroup } from "./agent-stream-rule-group";
import { AgentStreamUsageFooter } from "./agent-stream-usage-footer";

import { AgentMessage, AgentTurn } from "./agent-turn";
import {
  AGENT_STREAM_RUN_OUTCOMES,
  type AgentStreamRunOutcome,
  type StreamRowKind,
  type ProjectedStreamRow,
  type StreamActivityKey,
  deriveAgentStreamRunOutcome,
  scopeAgentStreamRunEvents,
  shouldShowAgentStreamHistoryAction,
  projectStreamRows,
  groupRepeatedActivities,
  STREAM_ROW_STATUSES,
  finalizeRuleHeaders,
  activityCopy,
  formatStreamValue,
  cleanedStreamValue,
  streamDuration,
  streamLabels,
  t,
} from "../../utils/agent-stream-projection";
export {
  deriveAgentStreamRunOutcome,
  AGENT_STREAM_RUN_OUTCOMES,
  type AgentStreamRunOutcome,
} from "../../utils/agent-stream-projection";

type AgentStreamTimelineProps = {
  events: AssessmentAgentStreamEvent[];
  activeRunId?: string | null;
  reset?: boolean;
  history?: WorkspaceRuntimeAgentStreamHistoryState;
  onLoadOlder?: () => void;
  className?: string;
  /** Nested inside AgentStreamTurn's own message/output chrome. */
  embedded?: boolean;
  /** Authoritative scan-job state may close a delayed or misattributed stream. */
  outcomeOverride?: AgentStreamRunOutcome;
};

export function AgentStreamTimeline({
  events,
  activeRunId = null,
  reset = false,
  history,
  onLoadOlder,
  className,
  embedded = false,
  outcomeOverride,
}: AgentStreamTimelineProps) {
  const visibleEvents = reset
    ? []
    : scopeAgentStreamRunEvents(events, activeRunId);
  const rows = settleRowsForOutcome(
    groupRepeatedActivities(projectStreamRows(visibleEvents)),
    outcomeOverride,
  );
  const ruleHeaders = finalizeRuleHeaders(
    projectAgentStreamRuleHeaders(visibleEvents),
    visibleEvents,
    outcomeOverride,
  );
  const segments = segmentAgentStreamRowsByRule(rows, ruleHeaders);
  const labels = streamLabels();
  const outcome = outcomeOverride ?? deriveAgentStreamRunOutcome(visibleEvents);
  const hasRunningActivity = outcome === AGENT_STREAM_RUN_OUTCOMES.running;
  const failed = outcome === AGENT_STREAM_RUN_OUTCOMES.failed;
  const paused = outcome === AGENT_STREAM_RUN_OUTCOMES.paused;
  const duration = streamDuration(visibleEvents);
  const showHistoryAction = shouldShowAgentStreamHistoryAction(
    history,
    onLoadOlder,
  );
  if (segments.length === 0 && !showHistoryAction) return null;

  const statusHeader = (
    <>
      {hasRunningActivity ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : failed ? (
        <XCircle className="size-3.5 text-destructive" />
      ) : paused ? (
        <PauseCircle className="size-3.5" />
      ) : (
        <CheckCircle2 className="size-3.5 text-emerald-500" />
      )}
      <span className={cn(failed && "text-destructive")}>
        {hasRunningActivity
          ? labels.thinking
          : failed
            ? labels.failed
            : paused
              ? activityCopy("boundaryPaused")
              : labels.completed}
        {!hasRunningActivity && duration ? ` · ${duration}` : ""}
      </span>
    </>
  );

  const body = (
    <>
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
      <div className="relative space-y-0.5">
        <div
          aria-hidden="true"
          className="absolute bottom-3 left-1.75 top-3 w-px bg-border/60"
        />
        {segments.map((segment) =>
          segment.kind === AGENT_STREAM_SEGMENT_KINDS.rule ? (
            <AgentStreamRuleGroup
              key={`rule:${segment.header.ruleId}`}
              header={segment.header}
            >
              {segment.rows.length > 0
                ? segment.rows.map((row) => (
                    <StreamRowView key={row.id} row={row} labels={labels} />
                  ))
                : null}
            </AgentStreamRuleGroup>
          ) : (
            <StreamRowView
              key={segment.row.id}
              row={segment.row}
              labels={labels}
            />
          ),
        )}
      </div>
    </>
  );

  // Embedded means this is already nested inside a caller-owned disclosure
  // (AgentStreamTurn's "Technical details"): it must not add a second,
  // separate expand to see the raw rows, so it renders a plain non-toggleable
  // status row plus the rows directly — no nested <details>/<summary> at all.
  // The outer disclosure is the only gate.
  const detailsBlock = embedded ? (
    <div data-slot="agent-stream-timeline" className={cn("min-w-0", className)}>
      <div className="flex items-center gap-2 py-1 text-xs font-medium text-muted-foreground">
        {statusHeader}
      </div>
      <div className="mt-1.5 space-y-2 pl-0.5">{body}</div>
    </div>
  ) : (
    <details
      data-slot="agent-stream-timeline"
      open={hasRunningActivity}
      className="group min-w-0"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium text-muted-foreground select-none">
        {statusHeader}
        <ChevronDown className="ml-0.5 size-3 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="mt-1.5 space-y-2 pl-0.5">{body}</div>
    </details>
  );

  if (embedded) {
    return detailsBlock;
  }

  return (
    <AgentTurn className={className}>
      <AgentMessage>
        {detailsBlock}
      </AgentMessage>
    </AgentTurn>
  );
}

/** An authoritative settled outcome closes rows whose end never streamed in. */
function settleRowsForOutcome(
  rows: ProjectedStreamRow[],
  outcome: AgentStreamRunOutcome | undefined,
): ProjectedStreamRow[] {
  if (outcome === undefined || outcome === AGENT_STREAM_RUN_OUTCOMES.running)
    return rows;
  const status =
    outcome === AGENT_STREAM_RUN_OUTCOMES.failed
      ? STREAM_ROW_STATUSES.failed
      : outcome === AGENT_STREAM_RUN_OUTCOMES.paused
        ? STREAM_ROW_STATUSES.neutral
        : STREAM_ROW_STATUSES.completed;
  return rows.map((row) =>
    row.status === STREAM_ROW_STATUSES.running ? { ...row, status } : row,
  );
}

function StreamTechnicalDetails({
  row,
  labels,
}: {
  row: ProjectedStreamRow;
  labels: ReturnType<typeof streamLabels>;
}) {
  const technical = cleanedStreamValue(row.technical);
  const hasToolPayload = row.input !== null || row.output !== null;
  if (technical === null && row.meta === null && !hasToolPayload) return null;

  return (
    <div
      data-stream-technical-details
      className="mt-2 space-y-2 border-t border-border/40 pt-2"
    >
      <div className="text-[11px] font-medium text-muted-foreground">
        {labels.technicalDetails}
      </div>
      {row.meta ? (
        <div className="whitespace-pre-wrap break-words wrap-anywhere font-mono text-[11px] leading-4 text-muted-foreground">
          {row.meta}
        </div>
      ) : null}
      {technical !== null ? (
        <pre className="max-h-72 overflow-auto rounded-lg border border-border/50 bg-background/60 px-2.5 py-2 text-[11px] leading-4 whitespace-pre-wrap break-words text-foreground/85">
          {formatStreamValue(technical)}
        </pre>
      ) : null}
      {row.input !== null ? (
        <StreamPayloadBlock label={labels.toolCall} value={row.input} />
      ) : null}
      {row.output !== null ? (
        <StreamPayloadBlock label={labels.toolOutput} value={row.output} />
      ) : null}
    </div>
  );
}

function StreamPayloadBlock({
  label,
  value,
}: {
  label: string;
  value: AssessmentRuntimeSummaryValue;
}) {
  const cleaned = cleanedStreamValue(value);
  if (cleaned === null) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-background/60">
      <div className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto border-t border-border/40 px-2.5 py-2 text-[11px] leading-4 whitespace-pre-wrap break-words text-foreground/85">
        {formatStreamValue(cleaned)}
      </pre>
    </div>
  );
}

function StreamRowView({
  row,
  labels,
}: {
  row: ProjectedStreamRow;
  labels: ReturnType<typeof streamLabels>;
}) {
  const statusLabel =
    row.status === "running"
      ? labels.running
      : row.status === "completed"
        ? labels.completed
        : row.status === "failed"
          ? labels.failed
          : null;

  return (
    <div
      data-stream-sequence={row.sequence}
      data-stream-kind={row.kind}
      data-stream-status={row.status}
      className="relative min-w-0 pl-6"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-2.25 z-10 flex size-3.75 items-center justify-center rounded-full bg-background text-muted-foreground",
          row.status === "failed" && "text-destructive",
          row.status === "completed" && "text-emerald-500",
        )}
      >
        <StreamStatusIcon row={row} />
      </span>
      <details
        data-stream-activity
        className={cn(
          "group/activity min-w-0 rounded-xl px-2.5 py-2 text-xs transition-colors duration-200 open:bg-muted/10",
          row.kind === "tool" && "border border-border/60 bg-muted/20",
          row.kind === "reasoning" && "bg-muted/10",
          row.failed && "border border-destructive/30 bg-destructive/5",
        )}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 select-none">
          <StreamKindIcon kind={row.kind} activity={row.activity} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span
              className={cn(
                "shrink-0 truncate font-medium text-foreground",
                row.failed && "text-destructive",
              )}
            >
              {row.label}
            </span>
            {row.target ? (
              <span
                data-stream-target
                className="min-w-0 truncate font-mono text-xs text-muted-foreground"
              >
                {row.target}
              </span>
            ) : null}
          </span>
          {row.completedTurns ? (
            <span
              data-stream-repeat-count={row.completedTurns.length}
              className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-xs text-muted-foreground"
            >
              ×{row.completedTurns.length}
            </span>
          ) : null}
          {statusLabel ? (
            <span
              className={cn(
                "shrink-0 text-[11px] text-muted-foreground",
                row.status === "running" && "animate-pulse",
                row.status === "failed" && "text-destructive",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
          <ChevronDown className="size-3 shrink-0 text-muted-foreground transition-transform duration-200 group-open/activity:rotate-180" />
        </summary>

        {row.completedTurns ? (
          <div className="mt-2 divide-y divide-border/40">
            {row.completedTurns.map((turn) => (
              <div
                key={turn.id}
                data-stream-turn={turn.id}
                className="min-w-0 py-2"
              >
                {turn.detail ? (
                  <div
                    data-stream-detail
                    className="whitespace-pre-wrap break-words wrap-anywhere text-xs leading-5 text-foreground/90"
                  >
                    {turn.detail}
                  </div>
                ) : null}
                <StreamTechnicalDetails row={turn} labels={labels} />
                <AgentStreamUsageFooter usage={turn.usage} className="mt-1" />
              </div>
            ))}
          </div>
        ) : row.detail ? (
          <div
            data-stream-detail
            className="mt-2 whitespace-pre-wrap break-words wrap-anywhere text-xs leading-5 text-foreground/90"
          >
            {row.detail}
          </div>
        ) : null}

        {!row.completedTurns ? (
          <StreamTechnicalDetails row={row} labels={labels} />
        ) : null}
      </details>
      {!row.completedTurns ? (
        <AgentStreamUsageFooter usage={row.usage} className="px-2.5 pt-0.5" />
      ) : null}
    </div>
  );
}

function StreamStatusIcon({ row }: { row: ProjectedStreamRow }) {
  if (row.status === "running") {
    return <LoaderCircle className="size-3.5 animate-spin" />;
  }
  if (row.status === "completed") {
    return <CheckCircle2 className="size-3.5" />;
  }
  if (row.status === "failed") {
    return <XCircle className="size-3.5" />;
  }
  return <Circle className="size-2.5 fill-current" />;
}

function StreamKindIcon({
  kind,
  activity,
}: {
  kind: StreamRowKind;
  activity: StreamActivityKey | null;
}) {
  const ActivityIcon = activity
    ? AGENT_STREAM_ACTIVITY_ICONS[activity]
    : undefined;
  if (kind === "tool" && ActivityIcon) {
    return (
      <ActivityIcon
        aria-hidden="true"
        data-stream-activity-icon={activity}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  }
  if (kind === "tool") {
    return (
      <Wrench
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  }
  if (kind === "reasoning" || kind === "model") {
    return (
      <Brain
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  }
  if (kind === "log") {
    return (
      <Terminal
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  }
  return null;
}
