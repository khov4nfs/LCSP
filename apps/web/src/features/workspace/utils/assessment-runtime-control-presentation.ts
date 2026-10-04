import {
  ASSESSMENT_AGENT_STREAM_STAGES,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";

import {
  ASSESSMENT_SIDEBAR_WORKFLOW_STAGES,
  NORMALIZED_WORKFLOW_STEP_STATUSES as Statuses,
  type NormalizedAssessmentRuntime,
} from "../types/assessment-runtime-adapter.types";
import { agentStreamRuntimeRunId } from "./agent-stream-identity";
import { selectAssessmentComposerRuntimeControl } from "./assessment-composer-control";

/** Overlay native control on customer presentation, never on persisted workflow results. */
export function applyAssessmentRuntimeControlPresentation(
  runtime: NormalizedAssessmentRuntime,
  events: AssessmentAgentStreamEvent[],
  control: AssessmentRuntimeControlResult | null | undefined,
): NormalizedAssessmentRuntime {
  const active = selectAssessmentComposerRuntimeControl(events, control);
  if (active.state !== ASSESSMENT_RUNTIME_CONTROL_STATES.stopped)
    return runtime;
  const latestWork = [...events]
    .filter(
      (event) =>
        event.stage !== null &&
        event.stage !== ASSESSMENT_AGENT_STREAM_STAGES.scanner &&
        agentStreamRuntimeRunId(event) === active.targetRunId,
    )
    .sort(
      (a, b) =>
        a.emittedAt.localeCompare(b.emittedAt) || a.sequence - b.sequence,
    )
    .at(-1);
  const stepId =
    latestWork?.stage === ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis
      ? ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.ruleAnalysis
      : latestWork?.stage === ASSESSMENT_AGENT_STREAM_STAGES.gate
        ? ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate
        : latestWork?.stage === ASSESSMENT_AGENT_STREAM_STAGES.interview
          ? ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview
          : null;
  if (stepId === null) return runtime;
  return {
    ...runtime,
    workflow: {
      ...runtime.workflow,
      steps: runtime.workflow.steps.map((step) =>
        step.id === stepId &&
        (step.status === Statuses.running || step.status === Statuses.waiting)
          ? { ...step, status: Statuses.stopped }
          : step,
      ),
    },
  };
}
