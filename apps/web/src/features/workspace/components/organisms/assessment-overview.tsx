"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import {
  useAssessmentDetailQuery,
  useHumanRequestsQuery,
} from "@/lib/api/assessment-domain-queries";
import { RepositorySetupStep } from "@/features/assessment-flow/components/organisms/repository-setup-step";
import {
  CanonicalAssessmentStatus,
  CanonicalAssessmentActivity,
} from "@/features/assessment-runtime/components/organisms/canonical-assessment-status";
import { useWorkspaceRuntime } from "./workspace-runtime-provider";
import { HumanResolutionForm } from "./human-resolution-form";
import { LegacyArchivePanel } from "./legacy-archive-panel";
import { AssessmentDecisions } from "./assessment-decisions";
import { AssessmentReportLink } from "../molecules/assessment-report-link";
import { AssessmentRuntimeActions } from "../molecules/assessment-runtime-actions";
import type { AssessmentOverviewProps } from "../../types/assessment-overview.types";

export function AssessmentOverview({ assessmentId }: AssessmentOverviewProps) {
  const detail = useAssessmentDetailQuery(assessmentId);
  const questions = useHumanRequestsQuery(assessmentId);
  const workspace = useWorkspaceRuntime();
  const timeline = workspace.getAssessmentRuntime(assessmentId);
  const client = useQueryClient();
  const sequence = timeline.canonicalAssessment?.runtime?.eventSequence;
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["assessment", assessmentId] });
  }, [client, assessmentId, sequence]);
  if (detail.isPending)
    return (
      <p className="p-6" role="status">
        {resolveAppMessage("pages.agenticAssessment.loading")}
      </p>
    );
  if (detail.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {resolveAppMessage("pages.agenticAssessment.requestFailed")}{" "}
          <Button variant="outline" onClick={() => void detail.refetch()}>
            {resolveAppMessage("pages.agenticAssessment.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  const assessment = detail.data;
  // No canonical state: either an assessment completed on the previous platform (archived,
  // read-only) or one that is not archived at all; the panel decides which and says so.
  if (!assessment.lifecycle || !assessment.runtime)
    return <LegacyArchivePanel assessmentId={assessmentId} />;
  if (assessment.lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.PREPARING)
    return <RepositorySetupStep assessmentId={assessmentId} />;
  const requests =
    questions.data?.requests.filter(
      (request) => request.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
    ) ?? [];
  return (
    <main
      className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-6"
      data-assessment-id={assessmentId}
      data-lifecycle-state={assessment.lifecycle.state}
      data-execution-state={assessment.runtime.executionState}
    >
      <CanonicalAssessmentStatus
        canonicalAssessment={{
          assessmentId,
          lifecycle: assessment.lifecycle,
          runtime: assessment.runtime,
        }}
        connectionState={workspace.connectionState}
      />
      <AssessmentRuntimeActions assessment={assessment} />
      {requests.length ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">
            {resolveAppMessage("pages.agenticAssessment.humanRequests")}
          </h2>
          {requests.map((request) => (
            <HumanResolutionForm
              key={`${request.requestId}:${request.requestRevision}`}
              assessmentId={assessmentId}
              request={request}
              caseRevision={questions.data!.caseRevision}
            />
          ))}
        </section>
      ) : null}
      {questions.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {resolveAppMessage("pages.agenticAssessment.requestFailed")}{" "}
            <Button variant="outline" onClick={() => void questions.refetch()}>
              {resolveAppMessage("pages.agenticAssessment.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <CanonicalAssessmentActivity events={timeline.canonicalEvents ?? []} />
      <AssessmentDecisions assessment={assessment} />
      <AssessmentReportLink assessment={assessment} />
    </main>
  );
}
