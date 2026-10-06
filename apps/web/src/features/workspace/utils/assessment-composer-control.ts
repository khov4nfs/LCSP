import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type CanonicalAssessmentRuntimeSnapshot,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";

import type { AssessmentComposerRuntimeControl } from "../types/assessment-composer.types";

/** Project controls from the server's canonical execution state only. */
export function selectAssessmentComposerRuntimeControl(
  canonicalAssessment: CanonicalAssessmentRuntimeSnapshot | null | undefined,
  control: AssessmentRuntimeControlResult | null | undefined,
): AssessmentComposerRuntimeControl {
  const lifecycle = canonicalAssessment?.lifecycle;
  const runtime = canonicalAssessment?.runtime;
  if (
    lifecycle === null ||
    lifecycle === undefined ||
    runtime === null ||
    runtime === undefined
  ) {
    return { state: null };
  }

  const targetRunId = runtime.currentExecutionId ?? undefined;
  if (!targetRunId) return { state: null };

  const canonicalState = (() => {
    switch (runtime.executionState) {
      case AGENT_EXECUTION_STATES.RUNNING:
        return States.running;
      case AGENT_EXECUTION_STATES.INTERRUPTED:
      case AGENT_EXECUTION_STATES.PAUSED:
        return States.stopped;
      case AGENT_EXECUTION_STATES.SUCCEEDED:
      case AGENT_EXECUTION_STATES.FAILED:
      case AGENT_EXECUTION_STATES.CANCELLED:
        return States.completed;
      case AGENT_EXECUTION_STATES.QUEUED:
      default:
        return null;
    }
  })();

  const pendingCommandMatchesCanonical =
    control?.targetRunId === targetRunId &&
    ((control.state === States.stopRequested &&
      canonicalState === States.running) ||
      (control.state === States.resumeRequested &&
        canonicalState === States.stopped));
  if (pendingCommandMatchesCanonical) return control;

  return { state: canonicalState, targetRunId };
}
