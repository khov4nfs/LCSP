import {
  ASSESSMENT_AGENT_STREAM_STAGES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";

import type { AgentStreamTurnProps } from "../../types/agent-stream-turn.types";
import { projectAgentStreamTurnOutput } from "../../utils/agent-stream-turn-output";
import { buildAgentStreamTurnHeadline } from "../../utils/agent-stream-turn-copy";
import { agentThinkingLabel } from "../../utils/agent-thinking-label";
import { AgentStreamActivityLog } from "./agent-stream-activity-log";
import { AgentStreamRuleAnalysisProgress } from "./agent-stream-rule-analysis-progress";
import { AgentStreamTimeline } from "./agent-stream-timeline";
import { AgentStreamUsageSummary } from "./agent-stream-usage-summary";
import {
  deriveAgentStreamRunOutcome,
  AGENT_STREAM_RUN_OUTCOMES,
  isAgentStreamDispatchFailed,
  shouldShowAgentStreamHistoryAction,
  withoutRoutingEvents,
  projectAgentStreamUsage,
} from "../../utils/agent-stream-projection";
import { AgentStreamTechnicalSummary } from "./agent-stream-technical-summary";
import { AgentStreamRuleAnalysisOutput } from "./agent-stream-rule-analysis-output";
import {
  AgentMessage,
  AgentTurn,
  ThinkingLine,
  ThoughtLine,
} from "./agent-turn";

/**
 * One customer-visible turn for one pipeline dispatch — which may span
 * several stages at once (Interview and rule analysis can run
 * synchronously inside the same boundary call). One headline, then each
 * participating stage's own output section, then the raw feed collapsed
 * behind Technical details.
 */
export function AgentStreamTurn({
  stages,
  runId,
  events,
  stageEvents,
  output,
  outcomeOverride,
  history,
  onLoadOlder,
  outputs,
  className,
}: AgentStreamTurnProps) {
  const outcome = outcomeOverride ?? deriveAgentStreamRunOutcome(events);
  const showHistoryAction = shouldShowAgentStreamHistoryAction(
    history,
    onLoadOlder,
  );
  const { actor, message } = buildAgentStreamTurnHeadline(stages, outcome);
  // Each investigated rule carries its own Technical details, so the
  // Rule analysis' turn-level feed keeps only events outside any rule.
  const investigating = stages.includes(
    ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
  );
  const ruleOwned = new Set(
    (stageEvents[ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis] ?? []).filter(
      (event) => event.engineeringRuleId,
    ),
  );
  const outsideRule = (event: (typeof events)[number]) => !ruleOwned.has(event);
  const technicalEvents = withoutRoutingEvents(
    investigating ? events.filter(outsideRule) : events,
  );
  const technicalStageEvents = investigating
    ? Object.fromEntries(
        Object.entries(stageEvents).map(([stage, items]) => [
          stage,
          (items ?? []).filter(outsideRule),
        ]),
      )
    : stageEvents;
  const labels = turnLabels();

  const { ruleAnalysisRules: ruleAnalysisRuleHeaders } =
    output ?? projectAgentStreamTurnOutput(stageEvents);

  return (
    <AgentTurn className={className}>
      <AgentMessage>
        <ThoughtLine label={actor} />
        {/* The Scanner step already carries this turn's thinking line. */}
        {stages.includes(ASSESSMENT_AGENT_STREAM_STAGES.scanner) ? null : (
          <ThinkingLine
            label={agentThinkingLabel(
              outcome === AGENT_STREAM_RUN_OUTCOMES.running,
              events,
            )}
            className="mt-1 text-muted-foreground"
          />
        )}
        <ThinkingLine label={message} className="mt-1" />

        {stages.includes(ASSESSMENT_AGENT_STREAM_STAGES.scanner) ? (
          <AgentStreamActivityLog events={events} />
        ) : null}

        {stages.includes(ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis) ? (
          <AgentStreamRuleAnalysisProgress
            events={events}
            dispatchRunning={outcome === AGENT_STREAM_RUN_OUTCOMES.running}
            outcome={outcome}
            pausedRuleIds={
              outcome === AGENT_STREAM_RUN_OUTCOMES.paused
                ? new Set(
                    ruleAnalysisRuleHeaders
                      .filter(
                        (rule) =>
                          rule.status ===
                          ASSESSMENT_RUNTIME_RUN_STATUSES.running,
                      )
                      .map((rule) => rule.ruleId),
                  )
                : undefined
            }
            // A rule cannot still be running once its dispatch has ended.
            rules={
              outcome === AGENT_STREAM_RUN_OUTCOMES.running
                ? ruleAnalysisRuleHeaders
                : ruleAnalysisRuleHeaders.map((rule) =>
                    rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running
                      ? {
                          ...rule,
                          status:
                            outcome === AGENT_STREAM_RUN_OUTCOMES.paused
                              ? ASSESSMENT_RUNTIME_RUN_STATUSES.waiting
                              : ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
                        }
                      : rule,
                  )
            }
          />
        ) : null}

        {/* Per-rule results live in each rule's row; only a dispatch-level
            failure is summarised here. */}
        {stages.includes(ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis) &&
        isAgentStreamDispatchFailed(events) ? (
          <AgentStreamRuleAnalysisOutput rules={[]} dispatchFailed />
        ) : null}

        {outputs ? <div className="mt-3 space-y-3">{outputs}</div> : null}

        {technicalEvents.length > 0 || showHistoryAction ? (
          <details
            className="mt-3 group/technical"
            data-slot="agent-stream-turn-technical-details"
          >
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground select-none">
              {labels.technicalDetails}
              <span>· {technicalEvents.length}</span>
            </summary>
            <AgentStreamTechnicalSummary
              events={technicalEvents}
              stageEvents={technicalStageEvents}
            />
            <details className="mt-2" data-stream-raw-events>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t("pages.appShell.agentStreamTechnicalSummary.rawEvents")} ·{" "}
                {technicalEvents.length}
              </summary>
              <div className="mt-1.5">
                <AgentStreamTimeline
                  events={technicalEvents}
                  activeRunId={runId}
                  embedded
                  outcomeOverride={outcomeOverride}
                  history={history}
                  onLoadOlder={onLoadOlder}
                />
              </div>
            </details>
          </details>
        ) : null}
        {outcome !== AGENT_STREAM_RUN_OUTCOMES.running ? (
          <AgentStreamUsageSummary
            aggregate={projectAgentStreamUsage(events)}
            titleKey="pages.appShell.agentStreamUsage.turnTotal"
            className="mt-3"
          />
        ) : null}
      </AgentMessage>
    </AgentTurn>
  );
}

function turnLabels() {
  return {
    technicalDetails: t("pages.appShell.agentStreamTechnicalDetails"),
  };
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
