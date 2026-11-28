"use client";

import {
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";
import type {
  AgentExecutionState,
  AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAssessmentRuntimeControl } from "@/lib/api/assessment-runtime-control-queries";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import { cn } from "@/lib/utils";
import type { CustomerAssessmentState } from "../../config/customer-assessment-states";
import {
  projectAssessmentRuntimeControl,
  RUNTIME_CONTROL_BUTTON_ACTIONS,
  RUNTIME_CONTROL_PHASES,
} from "../../utils/assessment-runtime-control-projection";
import { copy } from "../../utils/conversation-copy";

export type AssessmentRuntimeControlsProps = {
  assessmentId: string;
  lifecycleState?: AssessmentLifecycleState | null;
  executionState?: AgentExecutionState | null;
  customerState?: CustomerAssessmentState | null;
  auditMode?: string | null;
  targetRunId?: string | null;
  hasOpenHumanRequest?: boolean;
  /** Optional status indicator badge alongside the control button. */
  showStatus?: boolean;
  /** Optional compact inline layout without wrapping full-width error alerts. */
  compact?: boolean;
  className?: string;
  buttonClassName?: string;
  onReconcile?: () => void;
};

/**
 * Business purpose:
 * Provide the single reusable Pause/Resume runtime control across the assessment workspace header,
 * sticky interaction bar, selected-rule audit progress panel, and live output surfaces.
 *
 * Business rules:
 * - Uses `useAssessmentRuntimeControl` (backed by `/api/assessments/[id]/runtime/*`) and
 *   `projectAssessmentRuntimeControl` so every surface shares one authoritative state machine.
 * - Duplicate clicks are blocked while `PAUSING` (`STOP_REQUESTED`) or `RESUMING` (`RESUME_REQUESTED`).
 * - Never renders Resume on completed runs or during material HITL waits.
 * - On rejection/network failure, displays a recoverable error alert with a refresh/reconcile action.
 *
 * Execution flow:
 * 1. Subscribe to `useAssessmentRuntimeControl(assessmentId, ...)` and workspace connection state.
 * 2. Compute `projection = projectAssessmentRuntimeControl(...)`.
 * 3. Render optional status badge, the Pause or Resume button, and any recoverable error alert.
 *
 * Failure cases:
 * - Mutation failure (`stop.isError || resume.isError`) shows `bar.controlFailed` and triggers
 *   `control.refetch()` + `onReconcile?.()` when the user clicks Refresh.
 *
 * Side effects:
 * - Dispatches `stop.mutate(targetRunId)` or `resume.mutate(targetRunId)` via TanStack Query.
 */
export function AssessmentRuntimeControls({
  assessmentId,
  lifecycleState,
  executionState,
  customerState,
  auditMode,
  targetRunId,
  hasOpenHumanRequest = false,
  showStatus = false,
  compact = false,
  className,
  buttonClassName,
  onReconcile,
}: AssessmentRuntimeControlsProps) {
  const workspace = useWorkspaceRuntime();
  const { control, stop, resume } = useAssessmentRuntimeControl(assessmentId, {
    lifecycleState,
    executionState,
    customerState,
    auditMode: auditMode as never,
    targetRunId,
    connectionState: workspace.connectionState,
  });

  const projection = projectAssessmentRuntimeControl({
    lifecycleState,
    executionState,
    targetRunId,
    controlResult: control.data,
    hasOpenHumanRequest,
    isStopPending: stop.isPending,
    isResumePending: resume.isPending,
  });

  const hasError = stop.isError || resume.isError;
  if (!projection.action && !hasError) {
    return null;
  }

  const isPausing = projection.phase === RUNTIME_CONTROL_PHASES.PAUSING;
  const isResuming = projection.phase === RUNTIME_CONTROL_PHASES.RESUMING;
  const isPaused = projection.phase === RUNTIME_CONTROL_PHASES.PAUSED;

  const handleAction = () => {
    if (projection.disabled || !projection.targetRunId) return;
    if (projection.action === RUNTIME_CONTROL_BUTTON_ACTIONS.PAUSE) {
      stop.mutate(projection.targetRunId);
    } else if (projection.action === RUNTIME_CONTROL_BUTTON_ACTIONS.RESUME) {
      resume.mutate(projection.targetRunId);
    }
  };

  const handleReconcile = () => {
    stop.reset();
    resume.reset();
    void control.refetch();
    onReconcile?.();
  };

  return (
    <div
      data-slot="assessment-runtime-controls"
      data-runtime-phase={projection.phase}
      className={cn(
        "flex flex-wrap items-center gap-2",
        compact ? "inline-flex" : "w-auto",
        className,
      )}
    >
      {showStatus && projection.action ? (
        <Badge
          variant="outline"
          className={cn(
            isPaused || isPausing
              ? "border-status-warning-border bg-status-warning-bg text-status-warning"
              : "border-status-info-border bg-status-info-bg text-status-info",
          )}
        >
          {projection.phase === RUNTIME_CONTROL_PHASES.RUNNING ||
          isPausing ||
          isResuming ? (
            <LoaderCircleIcon
              className="mr-1 size-3 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          {copy(
            isPaused
              ? "state.PAUSED"
              : isPausing
                ? "bar.pausing"
                : isResuming
                  ? "bar.resuming"
                  : "state.WORKING",
          )}
        </Badge>
      ) : null}

      {projection.action === RUNTIME_CONTROL_BUTTON_ACTIONS.PAUSE ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={projection.disabled}
          onClick={handleAction}
          data-runtime-action="stop"
          className={buttonClassName}
        >
          {isPausing ? (
            <LoaderCircleIcon
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <PauseIcon className="size-3.5" aria-hidden="true" />
          )}
          {copy(isPausing ? "bar.pausing" : "bar.pause")}
        </Button>
      ) : projection.action === RUNTIME_CONTROL_BUTTON_ACTIONS.RESUME ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={projection.disabled}
          onClick={handleAction}
          data-runtime-action="continue"
          className={buttonClassName}
        >
          {isResuming ? (
            <LoaderCircleIcon
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <PlayIcon className="size-3.5" aria-hidden="true" />
          )}
          {copy(isResuming ? "bar.resuming" : "bar.resume")}
        </Button>
      ) : null}

      {hasError ? (
        <Alert
          variant="destructive"
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 py-2"
        >
          <AlertDescription className="text-xs">
            {copy("bar.controlFailed")}
          </AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReconcile}
            data-runtime-action="reconcile-error"
          >
            <RefreshCwIcon className="size-3" aria-hidden="true" />
            {copy("bar.refresh")}
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
