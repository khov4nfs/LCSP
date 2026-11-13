import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AgentExecutionState,
  type AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  type AssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import {
  CUSTOMER_ASSESSMENT_STATES,
  type CustomerAssessmentState,
} from "../../features/assessment-runtime/config/customer-assessment-states";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeConnectionState,
} from "../../features/workspace/types/workspace-runtime.types";

export type AssessmentAuditMode =
  (typeof ASSESSMENT_AUDIT_MODES)[keyof typeof ASSESSMENT_AUDIT_MODES];

/**
 * Standardized intervals (in milliseconds) for assessment runtime control polling.
 *
 * Polling adapts dynamically based on whether active execution is in flight,
 * whether the event stream (SSE) is connected, whether the tab is visible,
 * and whether the assessment has reached a terminal lifecycle state.
 */
export const ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS = {
  TRANSITION: 1_000,
  ACTIVE_STREAMING: 3_000,
  ACTIVE_FALLBACK: 2_000,
  IDLE_WAITING_STREAMING: 10_000,
  IDLE_WAITING_FALLBACK: 5_000,
  TERMINAL_RECONCILIATION: 30_000,
  ERROR_BACKOFF: 10_000,
  DISABLED: false,
} as const;

export type AssessmentRuntimeControlPollingInterval =
  (typeof ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS)[keyof typeof ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS];

export type RuntimeControlPollingContext = {
  controlState?: AssessmentRuntimeControlState | null;
  targetRunId?: string | null;
  lifecycleState?: AssessmentLifecycleState | null;
  executionState?: AgentExecutionState | null;
  customerState?: CustomerAssessmentState | null;
  auditMode?: AssessmentAuditMode | null;
  connectionState?: WorkspaceRuntimeConnectionState | null;
  isMutating?: boolean;
  hasQueryError?: boolean;
  isDocumentVisible?: boolean;
};

/**
 * Business purpose:
 * Compute a state-aware polling interval for assessment runtime control that balances
 * sub-second responsiveness during active transitions with bounded request traffic during
 * idle, paused, waiting, and terminal states.
 *
 * Business rules:
 * - Hidden/background tabs must not execute scheduled polls; window focus triggers immediate refetch.
 * - In-flight mutations (stop/resume) or pending transition states (STOP_REQUESTED, RESUME_REQUESTED)
 *   must poll at fast 1,000ms intervals until the worker acknowledges the target state.
 * - Active execution (RUNNING, QUEUED, WORKING, FINALIZING) polls at 3,000ms when SSE is connected
 *   and 2,000ms when SSE is disconnected/fallback.
 * - Paused or waiting states (STOPPED, PAUSED, WAITING, BLOCKED) back off to 10,000ms when SSE
 *   is connected, and 5,000ms when SSE is disconnected to detect external multi-tab answers or resumes.
 * - In CUSTOMER_SELECTED audit mode, an individual completed rule audit is NOT an assessment terminal state;
 *   the customer can select a new rule audit, so polling must remain in idle waiting mode.
 * - Truly terminal assessments (COMPLETE, FAILED, CANCELLED) disable scheduled polling when SSE is connected,
 *   and maintain a slow 30,000ms bounded reconciliation fallback when SSE is disconnected.
 * - Failed control queries back off to 10,000ms to prevent request storming during server friction.
 *
 * Execution flow:
 * 1. If document is hidden, disable scheduled polling (return false).
 * 2. If query experienced an error, return ERROR_BACKOFF interval.
 * 3. If mutation is in flight or state is transitioning (STOP_REQUESTED, RESUME_REQUESTED), return TRANSITION interval.
 * 4. If execution is actively running or queued, return ACTIVE_STREAMING if SSE is connected, else ACTIVE_FALLBACK.
 * 5. If execution is paused or stopped, return IDLE_WAITING_STREAMING if SSE is connected, else IDLE_WAITING_FALLBACK.
 * 6. If assessment is waiting for human resolution or clarification, return IDLE_WAITING_STREAMING or IDLE_WAITING_FALLBACK.
 * 7. If in CUSTOMER_SELECTED audit mode with active lifecycle, treat as non-terminal idle waiting.
 * 8. If assessment lifecycle is confirmed terminal, return DISABLED when SSE connected, else TERMINAL_RECONCILIATION.
 * 9. For any remaining state, return IDLE_WAITING_STREAMING or IDLE_WAITING_FALLBACK based on connection state.
 *
 * Failure cases:
 * - Missing or undefined context attributes default safely to the conservative idle waiting interval.
 *
 * Side effects:
 * - Pure computation; performs no network I/O, cache mutation, or timers.
 */
export function computeRuntimeControlPollingInterval(
  context: RuntimeControlPollingContext,
): number | false {
  if (context.isDocumentVisible === false) {
    return ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.DISABLED;
  }

  if (context.hasQueryError) {
    return ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.ERROR_BACKOFF;
  }

  const isTransitioning =
    context.isMutating === true ||
    context.controlState === ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested ||
    context.controlState === ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested;

  if (isTransitioning) {
    return ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.TRANSITION;
  }

  const isConnected =
    context.connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.connected;

  const isActive =
    context.controlState === ASSESSMENT_RUNTIME_CONTROL_STATES.running ||
    context.executionState === AGENT_EXECUTION_STATES.RUNNING ||
    context.executionState === AGENT_EXECUTION_STATES.QUEUED ||
    context.customerState === CUSTOMER_ASSESSMENT_STATES.WORKING ||
    context.customerState === CUSTOMER_ASSESSMENT_STATES.FINALIZING;

  if (isActive) {
    return isConnected
      ? ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.ACTIVE_STREAMING
      : ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.ACTIVE_FALLBACK;
  }

  const isPaused =
    context.controlState === ASSESSMENT_RUNTIME_CONTROL_STATES.stopped ||
    context.executionState === AGENT_EXECUTION_STATES.PAUSED ||
    context.customerState === CUSTOMER_ASSESSMENT_STATES.PAUSED ||
    context.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PAUSED;

  if (isPaused) {
    return isConnected
      ? ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_STREAMING
      : ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_FALLBACK;
  }

  const isWaiting =
    context.customerState === CUSTOMER_ASSESSMENT_STATES.WAITING ||
    context.customerState === CUSTOMER_ASSESSMENT_STATES.BLOCKED ||
    context.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
    context.lifecycleState ===
      ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT;

  if (isWaiting) {
    return isConnected
      ? ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_STREAMING
      : ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_FALLBACK;
  }

  const isSelectedModeActive =
    context.auditMode === ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED &&
    context.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE;

  if (isSelectedModeActive) {
    return isConnected
      ? ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_STREAMING
      : ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_FALLBACK;
  }

  const isTerminal =
    context.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE ||
    context.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.FAILED ||
    context.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.CANCELLED ||
    context.customerState === CUSTOMER_ASSESSMENT_STATES.COMPLETE ||
    context.customerState === CUSTOMER_ASSESSMENT_STATES.FAILED ||
    context.customerState === CUSTOMER_ASSESSMENT_STATES.CANCELLED;

  if (isTerminal) {
    return isConnected
      ? ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.DISABLED
      : ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.TERMINAL_RECONCILIATION;
  }

  return isConnected
    ? ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_STREAMING
    : ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS.IDLE_WAITING_FALLBACK;
}
