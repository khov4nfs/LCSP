"use client";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES } from "@lcsp/contracts/evidence";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resolveAppMessage } from "@/lib/i18n";
import { useAssessmentRuntimeControl } from "@/lib/api/assessment-runtime-control-queries";

export function AssessmentRuntimeActions({
  assessment,
}: {
  assessment: AssessmentDetail;
}) {
  const { control, stop, resume } = useAssessmentRuntimeControl(
    assessment.assessment_id,
  );
  const runtime = assessment.runtime;
  if (!runtime?.currentExecutionId || !assessment.lifecycle) return null;
  const pending =
    control.data?.targetRunId === runtime.currentExecutionId &&
    (control.data.state === ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested ||
      control.data.state === ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested);
  const canStop =
    assessment.lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
    runtime.executionState === AGENT_EXECUTION_STATES.RUNNING;
  const canResume =
    assessment.lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.PAUSED &&
    runtime.executionState === AGENT_EXECUTION_STATES.PAUSED;
  return (
    <div className="flex flex-col gap-2" data-canonical-controls="true">
      {canStop ? (
        <Button
          variant="outline"
          disabled={pending || stop.isPending}
          onClick={() => stop.mutate(runtime.currentExecutionId!)}
        >
          {resolveAppMessage("pages.agenticAssessment.stop")}
        </Button>
      ) : null}
      {canResume ? (
        <Button
          disabled={pending || resume.isPending}
          onClick={() => resume.mutate(runtime.currentExecutionId!)}
        >
          {resolveAppMessage("pages.agenticAssessment.continue")}
        </Button>
      ) : null}
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {resolveAppMessage("pages.agenticAssessment.controlPending")}
        </p>
      ) : null}
      {stop.isError || resume.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {resolveAppMessage("pages.agenticAssessment.requestFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
