import { AGENTIC_ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";
import { WORKSPACE_RUNTIME_CONNECTION_STATES } from "../../../workspace/types/workspace-runtime.types";
import {
  canonicalExecutionLabel,
  canonicalLifecycleLabel,
} from "../../../workspace/utils/assessment-runtime-formatter";
import type {
  CanonicalAssessmentActivityProps,
  CanonicalAssessmentStatusProps,
  CanonicalStateRowProps,
} from "../../types/canonical-assessment-status.types";

export function CanonicalAssessmentStatus({
  canonicalAssessment,
  connectionState,
}: CanonicalAssessmentStatusProps) {
  const lifecycle = canonicalAssessment?.lifecycle ?? null;
  const runtime = canonicalAssessment?.runtime ?? null;
  const isLoading =
    connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.connecting;

  return (
    <section
      aria-label={resolveAppMessage(
        "pages.appShell.runtimePanelCanonicalTitle",
      )}
      data-canonical-status={
        isLoading ? "LOADING" : lifecycle && runtime ? "PRESENT" : "UNAVAILABLE"
      }
    >
      <p className="mb-2 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {resolveAppMessage("pages.appShell.runtimePanelCanonicalTitle")}
      </p>
      {isLoading ? (
        <p className="rounded-xl border border-border/70 bg-card px-3.5 py-3 text-sm text-muted-foreground">
          {resolveAppMessage("pages.appShell.runtimePanelCanonicalLoading")}
        </p>
      ) : lifecycle && runtime ? (
        <dl className="grid gap-2 rounded-xl border border-border/70 bg-card px-3.5 py-3 text-sm">
          <CanonicalStateRow
            dataState={lifecycle.state}
            label={resolveAppMessage(
              "pages.appShell.runtimePanelCanonicalLifecycle",
            )}
            value={canonicalLifecycleLabel(lifecycle.state)}
          />
          <CanonicalStateRow
            dataState={runtime.executionState}
            label={resolveAppMessage(
              "pages.appShell.runtimePanelCanonicalExecution",
            )}
            value={canonicalExecutionLabel(runtime.executionState)}
          />
        </dl>
      ) : (
        <p className="rounded-xl border border-border/70 bg-card px-3.5 py-3 text-sm text-muted-foreground">
          {resolveAppMessage("pages.appShell.runtimePanelCanonicalUnavailable")}
        </p>
      )}
    </section>
  );
}

function CanonicalStateRow({
  dataState,
  label,
  value,
}: CanonicalStateRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <Badge variant="outline" data-canonical-state={dataState}>
          {value}
        </Badge>
      </dd>
    </div>
  );
}

export function CanonicalAssessmentActivity({
  events,
}: CanonicalAssessmentActivityProps) {
  const activity = events.filter(
    (event) =>
      event.eventType === AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
  );
  if (activity.length === 0) return null;

  return (
    <section
      aria-label={resolveAppMessage(
        "pages.appShell.runtimePanelCanonicalActivity",
      )}
      data-canonical-activity="true"
    >
      <p className="mb-2 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {resolveAppMessage("pages.appShell.runtimePanelCanonicalActivity")}
      </p>
      <ol className="rounded-xl border border-border/70 bg-card px-3.5">
        {activity.slice(0, 5).map((event) => (
          <li
            className="border-b border-border/50 py-2.5 text-sm last:border-b-0"
            data-event-id={event.eventId}
            key={event.eventId}
          >
            {resolveMessage(appLocale, event.payload.labelKey as MessageKey)}
          </li>
        ))}
      </ol>
    </section>
  );
}
