"use client";
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  ARTIFACT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_AUDIT_MODES } from "@lcsp/contracts/assessment-domain";
import { Button } from "@/components/ui/button";
import { ChatInteractionBar } from "@/components/molecules/chat-interaction-bar";
import { useAssessmentRuntimeControl } from "@/lib/api/assessment-runtime-control-queries";
import { useReconcileOrphanedAssessment } from "@/lib/api/assessment-domain-queries";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import {
  CUSTOMER_ASSESSMENT_STATES,
  type CustomerAssessmentState,
} from "../../config/customer-assessment-states";
import {
  projectAssessmentRuntimeControl,
  RUNTIME_CONTROL_PHASES,
} from "../../utils/assessment-runtime-control-projection";
import { copy } from "../../utils/conversation-copy";
import { AssessmentReportActions } from "./assessment-report-actions";
import { AssessmentRuntimeControls } from "./assessment-runtime-controls";

type AssessmentInteractionBarProps = {
  assessment: AssessmentDetail;
  state: CustomerAssessmentState;
  onRefresh: () => void;
};

/**
 * The sticky chat-style interaction area. It carries exactly one thing for the current state:
 * Stop while working, Continue while paused, a quiet wait note while a question is open, the
 * report actions when complete, or Refresh when the assessment needs attention.
 */
export function AssessmentInteractionBar({
  assessment,
  state,
  onRefresh,
}: AssessmentInteractionBarProps) {
  const workspace = useWorkspaceRuntime();
  const runtime = assessment.runtime;
  const executionId = runtime?.currentExecutionId ?? undefined;
  const { control, stop, resume } = useAssessmentRuntimeControl(
    assessment.assessment_id,
    {
      lifecycleState: assessment.lifecycle?.state,
      executionState: runtime?.executionState,
      customerState: state,
      auditMode: assessment.case?.auditMode,
      targetRunId: executionId,
      connectionState: workspace.connectionState,
    },
  );
  const reconcile = useReconcileOrphanedAssessment(assessment.assessment_id);
  const projection = projectAssessmentRuntimeControl({
    lifecycleState: assessment.lifecycle?.state,
    executionState: runtime?.executionState,
    targetRunId: executionId,
    controlResult: control.data,
    hasOpenHumanRequest: state === CUSTOMER_ASSESSMENT_STATES.WAITING,
    isStopPending: stop.isPending,
    isResumePending: resume.isPending,
  });
  const stopping = projection.phase === RUNTIME_CONTROL_PHASES.PAUSING;
  const isOrphanedQueued =
    assessment.lifecycle?.state === ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
    assessment.case?.auditMode !== ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED &&
    runtime?.executionState === AGENT_EXECUTION_STATES.QUEUED &&
    runtime.currentExecutionId === null;
  const report = assessment.case?.artifacts.find(
    (artifact) => artifact.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  const failed = reconcile.isError;

  if (
    state === CUSTOMER_ASSESSMENT_STATES.UNAVAILABLE ||
    state === CUSTOMER_ASSESSMENT_STATES.PREPARING ||
    state === CUSTOMER_ASSESSMENT_STATES.SELECTING
  )
    return null;

  return (
    <ChatInteractionBar>
      <div
        data-bar-state={state}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2"
      >
        {state === CUSTOMER_ASSESSMENT_STATES.WORKING && isOrphanedQueued ? (
          <>
            <p className="flex-1 text-sm text-muted-foreground">
              {copy("bar.orphaned")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reconcile.isPending}
              onClick={() => reconcile.mutate()}
              data-runtime-action="reconcile-orphaned"
            >
              {copy(reconcile.isPending ? "bar.reconciling" : "bar.reconcile")}
            </Button>
          </>
        ) : state === CUSTOMER_ASSESSMENT_STATES.WORKING ||
        state === CUSTOMER_ASSESSMENT_STATES.FINALIZING ? (
          <>
            <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
              />
              {copy(stopping ? "bar.pausing" : "bar.working")}
            </p>
            <AssessmentRuntimeControls
              assessmentId={assessment.assessment_id}
              lifecycleState={assessment.lifecycle?.state}
              executionState={runtime?.executionState}
              customerState={state}
              auditMode={assessment.case?.auditMode}
              targetRunId={executionId}
              hasOpenHumanRequest={false}
              onReconcile={onRefresh}
            />
          </>
        ) : state === CUSTOMER_ASSESSMENT_STATES.PAUSED ? (
          <>
            <p className="flex-1 text-sm text-muted-foreground">
              {copy("bar.pausedSummary")}
            </p>
            <AssessmentRuntimeControls
              assessmentId={assessment.assessment_id}
              lifecycleState={assessment.lifecycle?.state}
              executionState={runtime?.executionState}
              customerState={state}
              auditMode={assessment.case?.auditMode}
              targetRunId={executionId}
              hasOpenHumanRequest={false}
              onReconcile={onRefresh}
            />
          </>
        ) : state === CUSTOMER_ASSESSMENT_STATES.WAITING ? (
          <p className="text-sm text-muted-foreground">{copy("bar.waiting")}</p>
        ) : state === CUSTOMER_ASSESSMENT_STATES.COMPLETE ? (
          <>
            <p className="flex-1 text-sm text-muted-foreground">
              {copy("bar.complete")}
            </p>
            {report ? (
              <AssessmentReportActions
                assessmentId={assessment.assessment_id}
                artifactId={report.artifactId}
              />
            ) : null}
          </>
        ) : (
          <>
            <p className="flex-1 text-sm text-muted-foreground">
              {copy(
                state === CUSTOMER_ASSESSMENT_STATES.FAILED
                  ? "bar.failed"
                  : "bar.needsAttention",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
            >
              <RefreshCwIcon aria-hidden="true" />
              {copy("bar.refresh")}
            </Button>
          </>
        )}
        {failed ? (
          <p role="alert" className="w-full text-xs text-destructive">
            {copy("bar.controlFailed")}
          </p>
        ) : null}
      </div>
    </ChatInteractionBar>
  );
}
