"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { RepositorySetupStep } from "@/features/assessment-flow/components/organisms/repository-setup-step";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import { useAssessmentConversation } from "../../hooks/use-assessment-conversation";
import { useStructuredAnswerSubmit } from "../../hooks/use-structured-answer-submit";
import { CUSTOMER_ASSESSMENT_STATES } from "../../config/customer-assessment-states";
import { copy } from "../../utils/conversation-copy";
import { customerAssessmentState } from "../../utils/customer-assessment-state";
import { AssessmentInteractionBar } from "../molecules/assessment-interaction-bar";
import { AssessmentConversation } from "./assessment-conversation";

/**
 * The assessment page: ONE conversation with the Assessment Root plus a sticky interaction area.
 * Context (state, repository, rule set, usage, report) lives in the right sidebar, which never
 * repeats the chronology.
 */
export function AssessmentChatView({
  assessmentId,
  targetRequestId,
}: {
  assessmentId: string;
  targetRequestId?: string;
}) {
  const { detail, requests, events, projection } =
    useAssessmentConversation(assessmentId);
  const workspace = useWorkspaceRuntime();
  const client = useQueryClient();
  const sequence =
    workspace.getAssessmentRuntime(assessmentId).canonicalAssessment?.runtime
      ?.eventSequence;
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["assessment", assessmentId] });
  }, [client, assessmentId, sequence]);

  useEffect(() => {
    if (!targetRequestId) return;
    const el = document.querySelector(
      `[data-human-request="${targetRequestId}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLElement) {
        el.focus();
      }
    }
  }, [targetRequestId, projection.turns.length]);

  const openRequest =
    (targetRequestId
      ? requests.data?.requests.find(
          (request) => request.requestId === targetRequestId,
        )
      : null) ??
    requests.data?.requests.find(
      (request) => request.requestId === projection.openRequestId,
    );
  const answer = useStructuredAnswerSubmit(
    assessmentId,
    openRequest,
    requests.data?.caseRevision,
  );

  if (detail.isPending)
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
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
  if (!assessment.lifecycle || !assessment.runtime)
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        {resolveAppMessage("pages.agenticAssessment.unavailable")}
      </p>
    );
  if (assessment.lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.PREPARING)
    return <RepositorySetupStep assessmentId={assessmentId} />;

  const state = customerAssessmentState(
    assessment.lifecycle,
    assessment.runtime,
  );
  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-assessment-id={assessmentId}
      data-lifecycle-state={assessment.lifecycle.state}
      data-execution-state={assessment.runtime.executionState}
      data-customer-state={state}
    >
      {/* Announces state changes and a new question, never the technical event stream. */}
      <p role="status" aria-live="polite" className="sr-only">
        {copy(`state.${state}`)}
        {state === CUSTOMER_ASSESSMENT_STATES.WAITING && openRequest
          ? ` ${openRequest.question}`
          : ""}
      </p>
      <AssessmentConversation
        projection={projection}
        answerPending={answer.pending}
        answerFailed={answer.failed}
        onAnswer={(value) => void answer.submit(value)}
        footer={
          requests.isError || events.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                {resolveAppMessage("pages.agenticAssessment.requestFailed")}{" "}
                <Button
                  variant="outline"
                  onClick={() => {
                    void requests.refetch();
                    void events.refetch();
                  }}
                >
                  {resolveAppMessage("pages.agenticAssessment.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null
        }
      />
      <AssessmentInteractionBar
        assessment={assessment}
        state={state}
        onRefresh={() => {
          void detail.refetch();
          void requests.refetch();
          void events.refetch();
        }}
      />
    </main>
  );
}
