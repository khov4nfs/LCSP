import type {
  AssessmentAgentStreamEvent,
  AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";

import { selectAssessmentComposerRuntimeControl } from "./assessment-composer-control";
import { agentStreamRuntimeRunId } from "./agent-stream-identity";
import { projectCurrentRunUsage } from "./agent-stream-projection";

/** Scope control acknowledgements before choosing a native generation for usage. */
export function projectAssessmentRuntimeUsage(
  events: AssessmentAgentStreamEvent[],
  runId: string | null,
  control?: AssessmentRuntimeControlResult | null,
) {
  const currentEvents = runId
    ? events.filter((event) => event.runId === runId)
    : [];
  const latestNative = [...currentEvents]
    .sort(
      (a, b) =>
        a.emittedAt.localeCompare(b.emittedAt) || a.sequence - b.sequence,
    )
    .filter((event) => agentStreamRuntimeRunId(event) !== undefined)
    .at(-1);
  const nativeRunId = latestNative && agentStreamRuntimeRunId(latestNative);
  const targetInHistory =
    control?.targetRunId &&
    events.some(
      (event) => agentStreamRuntimeRunId(event) === control.targetRunId,
    ) &&
    (nativeRunId
      ? control.targetRunId !== nativeRunId
      : !currentEvents.some(
          (event) => agentStreamRuntimeRunId(event) === control.targetRunId,
        ));
  const generationEvents = nativeRunId
    ? currentEvents.filter(
        (event) => agentStreamRuntimeRunId(event) === nativeRunId,
      )
    : currentEvents;
  const active = selectAssessmentComposerRuntimeControl(
    generationEvents,
    targetInHistory ? undefined : control,
  );
  const nativeTarget =
    active.targetRunId && active.targetRunId !== runId
      ? active.targetRunId
      : currentEvents.some(
            (event) => agentStreamRuntimeRunId(event) === active.targetRunId,
          )
        ? active.targetRunId
        : undefined;
  return projectCurrentRunUsage(events, runId, nativeTarget);
}
