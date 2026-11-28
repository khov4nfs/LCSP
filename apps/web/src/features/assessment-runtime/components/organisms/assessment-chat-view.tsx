"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
} from "@lcsp/contracts/assessment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { useRepositorySetupQuery } from "@/lib/api/assessment-domain-queries";
import { RepositorySetupStep } from "@/features/assessment-flow/components/organisms/repository-setup-step";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import { useAssessmentConversation } from "../../hooks/use-assessment-conversation";
import { useStructuredAnswerSubmit } from "../../hooks/use-structured-answer-submit";
import { CUSTOMER_ASSESSMENT_STATES } from "../../config/customer-assessment-states";
import {
  CONVERSATION_TURN_KINDS,
  type DecisionTurn,
} from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";
import { customerAssessmentState } from "../../utils/customer-assessment-state";
import { AssessmentInteractionBar } from "../molecules/assessment-interaction-bar";
import { AssessmentRuntimeControls } from "../molecules/assessment-runtime-controls";
import { EvidenceInspector } from "../molecules/evidence-inspector";
import { SourceVersionSummary } from "../molecules/source-version-summary";
import { AssessmentConversation } from "./assessment-conversation";
import { AssessmentOutcomeSummary } from "./assessment-outcome-summary";
import {
  ASSESSMENT_WORKSPACE_TABS,
  AssessmentWorkspaceLayout,
  type AssessmentWorkspaceTab,
} from "./assessment-workspace-layout";
import { FindingList } from "./finding-list";
import { RuleAuditPicker } from "./rule-audit-picker";

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
  const setupQuery = useRepositorySetupQuery(assessmentId);
  const [activeTab, setActiveTab] = useState<AssessmentWorkspaceTab>(
    targetRequestId
      ? ASSESSMENT_WORKSPACE_TABS.requests
      : ASSESSMENT_WORKSPACE_TABS.overview,
  );
  const workspace = useWorkspaceRuntime();
  const client = useQueryClient();
  const sequence =
    workspace.getAssessmentRuntime(assessmentId).canonicalAssessment?.runtime
      ?.eventSequence;
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["assessment", assessmentId] });
    void client.invalidateQueries({
      queryKey: ["assessment-runtime-control", assessmentId],
    });
  }, [client, assessmentId, sequence]);

  useEffect(() => {
    if (!targetRequestId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-human-request="${targetRequestId}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }
  }, [targetRequestId, projection.turns.length]);

  const targetRequest = targetRequestId
    ? requests.data?.requests.find(
        (request) => request.requestId === targetRequestId,
      )
    : null;
  const openRequest =
    (targetRequest && targetRequest.status === "OPEN" ? targetRequest : null) ??
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
    assessment.case,
  );
  const openRequestsCount = (requests.data?.requests ?? []).filter(
    (request) => request.status.toLowerCase() === "open",
  ).length;
  const decisionTurns = projection.turns.filter(
    (turn): turn is DecisionTurn =>
      turn.kind === CONVERSATION_TURN_KINDS.DECISION,
  );
  const applicableTurns = decisionTurns.filter(
    (turn) =>
      turn.record.decision.applicability ===
      RULE_DECISION_APPLICABILITIES.APPLICABLE,
  );
  const outcomeCounts = {
    compliant: applicableTurns.filter(
      (turn) =>
        turn.record.decision.applicability ===
          RULE_DECISION_APPLICABILITIES.APPLICABLE &&
        turn.record.decision.compliance ===
          RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
    ).length,
    nonCompliant: applicableTurns.filter(
      (turn) =>
        turn.record.decision.applicability ===
          RULE_DECISION_APPLICABILITIES.APPLICABLE &&
        turn.record.decision.compliance ===
          RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    ).length,
    needsInfo: openRequestsCount,
    notRequested: applicableTurns.filter(
      (turn) =>
        turn.record.decision.applicability ===
          RULE_DECISION_APPLICABILITIES.APPLICABLE &&
        turn.record.decision.compliance !==
          RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT &&
        turn.record.decision.compliance !==
          RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    ).length,
  };
  const repositoryName =
    setupQuery.data?.connection?.repositoryFullName ?? null;
  const commitSha =
    setupQuery.data?.snapshot?.commitSha ??
    assessment.case?.repositoryCommit ??
    null;
  const legalSourceVersion =
    assessment.case?.ruleSet?.legalSourceVersion ?? null;

  const runtimeControls = (
    <AssessmentRuntimeControls
      assessmentId={assessmentId}
      lifecycleState={assessment.lifecycle.state}
      executionState={assessment.runtime.executionState}
      customerState={state}
      auditMode={assessment.case?.auditMode}
      targetRunId={assessment.runtime.currentExecutionId}
      hasOpenHumanRequest={
        state === CUSTOMER_ASSESSMENT_STATES.WAITING || Boolean(openRequest)
      }
      compact
      onReconcile={() => {
        void detail.refetch();
        void requests.refetch();
        void events.refetch();
      }}
    />
  );

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-assessment-id={assessmentId}
      data-lifecycle-state={assessment.lifecycle.state}
      data-execution-state={assessment.runtime.executionState}
      data-customer-state={state}
    >
      {(detail.data.localizationFallback ||
        requests.data?.localizationFallback) && (
        <Alert role="status">
          <AlertDescription>
            {resolveAppMessage(
              "pages.assessmentConversation.localizationFallback",
            )}
          </AlertDescription>
        </Alert>
      )}
      {/* Announces state changes and a new question, never the technical event stream. */}
      <p role="status" aria-live="polite" className="sr-only">
        {copy(`state.${state}`)}
        {state === CUSTOMER_ASSESSMENT_STATES.WAITING && openRequest
          ? ` ${openRequest.question}`
          : ""}
      </p>

      <AssessmentWorkspaceLayout
        title={assessment.name}
        statusLabel={copy(`state.${state}`)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        openRequestsCount={openRequestsCount}
        onAuditSelectedRules={() =>
          setActiveTab(ASSESSMENT_WORKSPACE_TABS.requests)
        }
        runtimeControls={runtimeControls}
        interactionBar={
          <AssessmentInteractionBar
            assessment={assessment}
            state={state}
            onRefresh={() => {
              void detail.refetch();
              void requests.refetch();
              void events.refetch();
            }}
          />
        }
      >
        {activeTab === ASSESSMENT_WORKSPACE_TABS.overview ? (
          <AssessmentOutcomeSummary
            assessmentId={assessmentId}
            counts={outcomeCounts}
            openRequestQuestion={openRequest?.question}
            repositoryName={repositoryName}
            commitSha={commitSha}
            legalSourceVersion={legalSourceVersion}
            onReviewFindings={() =>
              setActiveTab(ASSESSMENT_WORKSPACE_TABS.findings)
            }
            onAnswerRequest={
              openRequest
                ? () => setActiveTab(ASSESSMENT_WORKSPACE_TABS.requests)
                : undefined
            }
            onViewSourceEvidence={() =>
              setActiveTab(ASSESSMENT_WORKSPACE_TABS.source)
            }
            onAuditSelectedRules={() =>
              setActiveTab(ASSESSMENT_WORKSPACE_TABS.requests)
            }
          />
        ) : activeTab === ASSESSMENT_WORKSPACE_TABS.findings ? (
          <FindingList turns={decisionTurns} />
        ) : activeTab === ASSESSMENT_WORKSPACE_TABS.source ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
              <SourceVersionSummary
                assessmentId={assessmentId}
                repositoryName={repositoryName}
                commitSha={commitSha}
                legalSourceVersion={legalSourceVersion}
                showArtifactLinks
              />
            </div>
            <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
              <EvidenceInspector
                evidenceList={[]}
                hasEvidenceGap={applicableTurns.length === 0}
              />
            </div>
          </div>
        ) : (
          <AssessmentConversation
            projection={projection}
            intro={
              <RuleAuditPicker
                assessmentId={assessmentId}
                paused={state === CUSTOMER_ASSESSMENT_STATES.PAUSED}
                runtimeControls={runtimeControls}
              />
            }
            targetRequestId={targetRequestId}
            answerPending={answer.pending}
            answerFailed={answer.failed}
            answerStaleConflict={answer.staleConflict}
            submittingRequestId={answer.submittingRequestId}
            failedRequestId={answer.failedRequestId}
            staleConflictRequestId={answer.staleConflictRequestId}
            onAnswer={(value, req) => void answer.submit(value, req)}
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
        )}
      </AssessmentWorkspaceLayout>
    </main>
  );
}
