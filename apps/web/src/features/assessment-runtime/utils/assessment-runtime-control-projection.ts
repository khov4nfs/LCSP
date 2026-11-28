import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AgentExecutionState,
  type AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";

/**
 * Canonical UI phase projected from authoritative backend lifecycle, execution,
 * and runtime-control acknowledgement states.
 */
export const RUNTIME_CONTROL_PHASES = {
  NONE: "IDLE",
  RUNNING: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
  PAUSING: ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested,
  PAUSED: ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
  RESUMING: ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested,
  WAITING_FOR_HUMAN: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
  COMPLETED: ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
} as const;

export type RuntimeControlPhase =
  (typeof RUNTIME_CONTROL_PHASES)[keyof typeof RUNTIME_CONTROL_PHASES];

export const RUNTIME_CONTROL_BUTTON_ACTIONS = {
  PAUSE: "PAUSE",
  RESUME: "RESUME",
} as const;

export type RuntimeControlButtonAction =
  (typeof RUNTIME_CONTROL_BUTTON_ACTIONS)[keyof typeof RUNTIME_CONTROL_BUTTON_ACTIONS];

export type AssessmentRuntimeControlProjectionInput = {
  lifecycleState?: AssessmentLifecycleState | null;
  executionState?: AgentExecutionState | null;
  targetRunId?: string | null;
  controlResult?: AssessmentRuntimeControlResult | null;
  hasOpenHumanRequest?: boolean;
  isStopPending?: boolean;
  isResumePending?: boolean;
};

export type AssessmentRuntimeControlProjection = {
  phase: RuntimeControlPhase;
  action: RuntimeControlButtonAction | null;
  disabled: boolean;
  targetRunId: string | undefined;
  canPause: boolean;
  canResume: boolean;
};

/**
 * Business purpose:
 * Project one authoritative Pause/Resume control state across the assessment workspace,
 * selected-rule progress panel, and live conversation/output surfaces.
 *
 * Business rules:
 * - Maps directly to backend lifecycle, execution, and runtime-control acknowledgement states
 *   rather than maintaining a parallel client-side state machine.
 * - Completed, failed, and cancelled runs never expose Pause or Resume.
 * - Material HITL waits (`WAITING_FOR_HUMAN` or an open human request) require answering the
 *   question and never allow bypassing via Resume.
 * - Pending acknowledgements (`STOP_REQUESTED`, `RESUME_REQUESTED`) or in-flight mutations
 *   render disabled transitional labels (`Pausing…`, `Resuming…`) fenced to `targetRunId`.
 *
 * Execution flow:
 * 1. Check terminal lifecycle/execution states -> return `COMPLETED` with no action.
 * 2. Check material HITL wait -> return `WAITING_FOR_HUMAN` with no action.
 * 3. If `targetRunId` is missing -> return `NONE` with no action.
 * 4. If active & running -> return `PAUSING` (when stop requested/pending) or `RUNNING` (`PAUSE`).
 * 5. If paused & (paused or interrupted) -> return `RESUMING` (when resume requested/pending) or `PAUSED` (`RESUME`).
 * 6. Otherwise return `NONE`.
 *
 * Failure cases:
 * - Missing or mismatched `targetRunId` prevents stale control polls from enabling invalid actions.
 *
 * Side effects:
 * - Pure projection function; performs no mutations or network calls.
 */
export function projectAssessmentRuntimeControl(
  input: AssessmentRuntimeControlProjectionInput,
): AssessmentRuntimeControlProjection {
  const {
    lifecycleState,
    executionState,
    targetRunId,
    controlResult,
    hasOpenHumanRequest = false,
    isStopPending = false,
    isResumePending = false,
  } = input;

  const normalizedRunId = targetRunId ?? undefined;

  // Terminal states never expose Pause or Resume so completed/failed runs cannot be re-triggered.
  if (
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE ||
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.FAILED ||
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.CANCELLED ||
    executionState === AGENT_EXECUTION_STATES.SUCCEEDED ||
    executionState === AGENT_EXECUTION_STATES.FAILED ||
    executionState === AGENT_EXECUTION_STATES.CANCELLED ||
    controlResult?.state === ASSESSMENT_RUNTIME_CONTROL_STATES.completed
  ) {
    return {
      phase: RUNTIME_CONTROL_PHASES.COMPLETED,
      action: null,
      disabled: true,
      targetRunId: normalizedRunId,
      canPause: false,
      canResume: false,
    };
  }

  // Material HITL wait must be answered via the question form, never bypassed by Resume.
  if (
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
    hasOpenHumanRequest
  ) {
    return {
      phase: RUNTIME_CONTROL_PHASES.WAITING_FOR_HUMAN,
      action: null,
      disabled: true,
      targetRunId: normalizedRunId,
      canPause: false,
      canResume: false,
    };
  }

  if (!normalizedRunId) {
    return {
      phase: RUNTIME_CONTROL_PHASES.NONE,
      action: null,
      disabled: true,
      targetRunId: undefined,
      canPause: false,
      canResume: false,
    };
  }

  // Fence control poll state to the active execution generation to ignore stale run responses.
  const controlMatchesRun = controlResult?.targetRunId === normalizedRunId;

  if (
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
    executionState === AGENT_EXECUTION_STATES.RUNNING
  ) {
    const pausing =
      isStopPending ||
      (controlMatchesRun &&
        controlResult?.state ===
          ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested);
    return {
      phase: pausing
        ? RUNTIME_CONTROL_PHASES.PAUSING
        : RUNTIME_CONTROL_PHASES.RUNNING,
      action: RUNTIME_CONTROL_BUTTON_ACTIONS.PAUSE,
      disabled: pausing,
      targetRunId: normalizedRunId,
      canPause: !pausing,
      canResume: false,
    };
  }

  if (
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PAUSED &&
    (executionState === AGENT_EXECUTION_STATES.PAUSED ||
      executionState === AGENT_EXECUTION_STATES.INTERRUPTED)
  ) {
    const resuming =
      isResumePending ||
      (controlMatchesRun &&
        controlResult?.state ===
          ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested);
    return {
      phase: resuming
        ? RUNTIME_CONTROL_PHASES.RESUMING
        : RUNTIME_CONTROL_PHASES.PAUSED,
      action: RUNTIME_CONTROL_BUTTON_ACTIONS.RESUME,
      disabled: resuming,
      targetRunId: normalizedRunId,
      canPause: false,
      canResume: !resuming,
    };
  }

  return {
    phase: RUNTIME_CONTROL_PHASES.NONE,
    action: null,
    disabled: true,
    targetRunId: normalizedRunId,
    canPause: false,
    canResume: false,
  };
}
