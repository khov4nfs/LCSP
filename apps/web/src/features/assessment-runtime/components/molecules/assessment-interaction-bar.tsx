"use client";
import { LoaderCircleIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  ARTIFACT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES } from "@lcsp/contracts/evidence";
import { Button } from "@/components/ui/button";
import { ChatInteractionBar } from "@/components/molecules/chat-interaction-bar";
import { useAssessmentRuntimeControl } from "@/lib/api/assessment-runtime-control-queries";
import {
  CUSTOMER_ASSESSMENT_STATES,
  type CustomerAssessmentState,
} from "../../config/customer-assessment-states";
import { copy } from "../../utils/conversation-copy";
import { AssessmentReportActions } from "./assessment-report-actions";

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
  const { control, stop, resume } = useAssessmentRuntimeControl(
    assessment.assessment_id,
  );
  const runtime = assessment.runtime;
  const executionId = runtime?.currentExecutionId ?? undefined;
  const requested =
    executionId !== undefined &&
    control.data?.targetRunId === executionId &&
    (control.data.state === ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested ||
      control.data.state === ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested);
  const stopping =
    stop.isPending ||
    (requested &&
      control.data?.state === ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested);
  const continuing =
    resume.isPending ||
    (requested &&
      control.data?.state === ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested);
  const canStop =
    executionId !== undefined &&
    assessment.lifecycle?.state === ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
    runtime?.executionState === AGENT_EXECUTION_STATES.RUNNING;
  const canResume =
    executionId !== undefined &&
    assessment.lifecycle?.state === ASSESSMENT_LIFECYCLE_STATES.PAUSED &&
    runtime?.executionState === AGENT_EXECUTION_STATES.PAUSED;
  const report = assessment.case?.artifacts.find(
    (artifact) => artifact.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  const failed = stop.isError || resume.isError;

  if (
    state === CUSTOMER_ASSESSMENT_STATES.UNAVAILABLE ||
    state === CUSTOMER_ASSESSMENT_STATES.PREPARING
  )
    return null;

  return (
    <ChatInteractionBar>
      <div
        data-bar-state={state}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2"
      >
        {state === CUSTOMER_ASSESSMENT_STATES.WORKING ||
        state === CUSTOMER_ASSESSMENT_STATES.FINALIZING ? (
          <>
            <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
              />
              {copy(stopping ? "bar.stopping" : "bar.working")}
            </p>
            {canStop ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={stopping}
                onClick={() => stop.mutate(executionId)}
                data-runtime-action="stop"
              >
                <SquareIcon aria-hidden="true" />
                {copy(stopping ? "bar.stopping" : "bar.stop")}
              </Button>
            ) : null}
          </>
        ) : state === CUSTOMER_ASSESSMENT_STATES.PAUSED ? (
          <Button
            type="button"
            className="w-full"
            disabled={!canResume || continuing}
            onClick={() => resume.mutate(executionId)}
            data-runtime-action="continue"
          >
            {copy(continuing ? "bar.continuing" : "bar.continue")}
          </Button>
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
