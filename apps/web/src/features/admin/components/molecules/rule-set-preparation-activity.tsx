"use client";

import type { MessageKey } from "@lcsp/i18n";
import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  preparationTokenUsage,
  projectPreparationActivity,
} from "../../utils/rule-set-preparation-activity";
import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";

type Props = {
  events: AssessmentAgentStreamEvent[];
  terminal: boolean;
  cancelled?: boolean;
  connected: boolean;
};

export function RuleSetPreparationActivity({
  events,
  terminal,
  cancelled = false,
  connected,
}: Props) {
  const activities = projectPreparationActivity(events, terminal, cancelled);
  const usage = preparationTokenUsage(events);
  return (
    <section
      className="rounded-lg border border-border/70 bg-muted/20 p-4"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.complianceRuleSets.activity.title")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {connected
            ? resolveAppMessage("pages.complianceRuleSets.activity.live")
            : resolveAppMessage(
                "pages.complianceRuleSets.activity.reconnecting",
              )}
        </span>
      </div>
      {activities.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {resolveAppMessage("pages.complianceRuleSets.activity.empty")}
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {activities.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-border/60 bg-background p-3"
            >
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "size-2 rounded-full bg-muted-foreground",
                    item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running &&
                      "animate-pulse bg-primary",
                    item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed &&
                      "bg-emerald-600",
                    item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed &&
                      "bg-destructive",
                  )}
                  aria-hidden="true"
                />
                <span className="font-medium">
                  {resolveAppMessage(item.labelKey as MessageKey)}
                </span>
                {item.details.sourcePath ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {item.details.sourcePath}
                  </span>
                ) : null}
              </div>
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {resolveAppMessage(
                    "pages.complianceRuleSets.activity.technicalDetails",
                  )}
                </summary>
                <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.agent"
                    value={item.details.agent}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.subagent"
                    value={item.details.subagent}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.provider"
                    value={item.details.provider}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.model"
                    value={item.details.model}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.tool"
                    value={item.details.nativeTool}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.run"
                    value={item.details.runId}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.toolCall"
                    value={item.details.toolCallId}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.modelStep"
                    value={item.details.modelStepId}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.inputTokens"
                    value={item.details.inputTokens}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.outputTokens"
                    value={item.details.outputTokens}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.totalTokens"
                    value={item.details.totalTokens}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.sourcePath"
                    value={item.details.sourcePath}
                  />
                </dl>
              </details>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {resolveAppMessage("pages.complianceRuleSets.activity.tokenUsage")}:{" "}
        {usage.totalTokens.toLocaleString()}
      </p>
    </section>
  );
}

function Detail({
  labelKey,
  value,
}: {
  labelKey: MessageKey;
  value: string | number | null;
}) {
  if (value === null || value === "") return null;
  return (
    <div>
      <dt className="font-medium">{resolveAppMessage(labelKey)}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
