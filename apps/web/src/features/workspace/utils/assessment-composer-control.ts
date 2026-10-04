import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as Events,
  ASSESSMENT_AGENT_STREAM_STAGES as Stages,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";

import { mergeRuntimeControlResponse } from "@/lib/api/assessment-runtime-control-state";
import type { AssessmentComposerRuntimeControl } from "../types/assessment-composer.types";
import {
  AGENT_STREAM_RUN_OUTCOMES,
  deriveAgentStreamRunOutcome,
} from "./agent-stream-projection";
import {
  agentStreamRuntimeRunId,
  groupAgentStreamEventsByRun,
} from "./agent-stream-stages";

function runtimeLifecycle(event: AssessmentAgentStreamEvent) {
  const state =
    event.eventType === Events.runtimeStopRequested
      ? States.stopRequested
      : event.eventType === Events.runtimeStopped
        ? States.stopped
        : event.eventType === Events.runtimeResumeRequested
          ? States.resumeRequested
          : event.eventType === Events.runtimeResumed
            ? States.running
            : event.eventType === Events.runtimeCompleted
              ? States.completed
              : null;
  if (state === null) return null;
  return {
    state,
    targetRunId: agentStreamRuntimeRunId(event) ?? event.runId,
    requestId: null,
  };
}

/** Live thinking and the composer must agree even before the control poll lands. */
export function selectAssessmentComposerRuntimeControl(
  events: AssessmentAgentStreamEvent[],
  control: AssessmentRuntimeControlResult | null | undefined,
): AssessmentComposerRuntimeControl {
  const groups = groupAgentStreamEventsByRun(events).filter((group) =>
    group.events.some(
      (event) =>
        (event.stage !== null && event.stage !== Stages.scanner) ||
        runtimeLifecycle(event) !== null,
    ),
  );
  const latest = groups.at(-1);
  if (!latest) return control ?? { state: null };

  const nativeRunId = latest.events.map(agentStreamRuntimeRunId).find(Boolean);
  const streamControl =
    latest.events.reduce<AssessmentRuntimeControlResult | null>(
      (current, event) =>
        mergeRuntimeControlResponse(current, runtimeLifecycle(event)),
      null,
    );
  const polledTurnIsInHistory =
    control !== null &&
    control !== undefined &&
    groups
      .slice(0, -1)
      .some((group) =>
        group.events.some(
          (event) => agentStreamRuntimeRunId(event) === control.targetRunId,
        ),
      );

  if (streamControl) {
    if (control?.targetRunId === streamControl.targetRunId) {
      return mergeRuntimeControlResponse(control, streamControl)!;
    }
    // A poll may acknowledge a new generation before its SSE arrives. Once
    // that generation is in history, the newer stream acknowledgement wins.
    if (
      control &&
      !polledTurnIsInHistory &&
      control.state !== States.completed
    ) {
      return control;
    }
    return streamControl;
  }
  if (control) {
    if (control.targetRunId === nativeRunId) return control;
    // Model/tool activity never overrides a stop or resume acknowledgement.
    if (
      control.state !== States.completed &&
      (!polledTurnIsInHistory || control.state !== States.running)
    ) {
      return control;
    }
  }
  // A previous completed record cannot turn a newer live turn into Continue.
  // Only native RUNTIME_STOPPED above is allowed to produce STOPPED.
  return {
    state:
      deriveAgentStreamRunOutcome(latest.events) ===
      AGENT_STREAM_RUN_OUTCOMES.running
        ? States.running
        : null,
    targetRunId: nativeRunId,
  };
}
