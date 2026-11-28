"use client";

import {
  DISCOVERY_INTERVIEW_PROPOSAL_STATUSES,
  type DiscoveryInterviewProposal,
} from "@lcsp/contracts/assessment-domain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiscoveryProvenanceItem } from "../../utils/discovery-interaction";
import { copy } from "../../utils/conversation-copy";
import {
  DiscoveryContextQuestionForm,
  type DiscoveryContextQuestion,
} from "./discovery-context-question";
import { SuggestedAnswerDecision } from "./suggested-answer-decision";

/**
 * Business purpose: Present one Discovery context question, its evidence provenance, and explicit confirm/reject/correct controls.
 * Business rules:
 * - A submitted or suggested answer stays `PENDING_REVIEW` until explicit owner confirmation.
 * - Rejected or ambiguous answers require a corrected answer before continuation is allowed.
 * - Source evidence provenance is shown from pinned discovery ranges; missing evidence is stated explicitly.
 * Execution flow:
 * 1. Render card heading reflecting current proposal state (`Context question`, `Context confirmed`, or `Correct the suggested answer`).
 * 2. Show feature name, question prompt, current answer/status, and evidence provenance list.
 * 3. Render confirm/reject actions for pending proposals or the validated correction form for unanswered/rejected items.
 * Failure cases:
 * - Ambiguous answers (`guardFailure`) disable confirmation and prompt rejection/rewriting.
 * Side effects:
 * - Forwards explicit submit/confirm/reject actions to parent handlers.
 */
export function ContextQuestionCard({
  entry,
  existing,
  provenance,
  canEdit,
  reviewComplete,
  caseRevision,
  isSubmitPending,
  isReviewPending,
  onSubmitAnswer,
  onConfirm,
  onReject,
}: {
  entry: DiscoveryContextQuestion;
  existing: DiscoveryInterviewProposal | undefined;
  provenance: DiscoveryProvenanceItem[];
  canEdit: boolean;
  reviewComplete: boolean;
  caseRevision: number | undefined;
  isSubmitPending: boolean;
  isReviewPending: boolean;
  onSubmitAnswer: (data: {
    idempotencyKey: string;
    useCaseId: string;
    question: string;
    answer: string;
  }) => Promise<unknown>;
  onConfirm: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}) {
  const isAccepted =
    existing?.status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.accepted;
  const isPendingReview =
    existing?.status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview;
  const isRejected =
    existing?.status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.rejected;

  const headingKey = isAccepted
    ? "ruleAudit.discovery.contextConfirmedTitle"
    : isRejected
      ? "ruleAudit.discovery.contextRejectedTitle"
      : "ruleAudit.discovery.contextQuestionTitle";

  return (
    <Card data-slot="context-question-card" className="border-border bg-card">
      <CardHeader className="gap-1.5 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{copy(headingKey)}</CardTitle>
          {isAccepted ? (
            <Badge
              variant="outline"
              className="border-status-success-border bg-status-success-bg text-status-success"
            >
              {copy("ruleAudit.discovery.suggestedRulesBadgeConfirmed")}
            </Badge>
          ) : isPendingReview ? (
            <Badge
              variant="outline"
              className="border-status-warning-border bg-status-warning-bg text-status-warning"
            >
              {copy("ruleAudit.discovery.suggestedRulesBadgeReview")}
            </Badge>
          ) : isRejected ? (
            <Badge
              variant="outline"
              className="border-status-warning-border bg-status-warning-bg text-status-warning"
            >
              {copy("ruleAudit.discovery.suggestedRulesBadgeNeedsContext")}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          {entry.useCaseName}
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm font-medium text-foreground">{entry.question}</p>

        {isAccepted && existing ? (
          <div role="status" className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              {copy("ruleAudit.discovery.contextConfirmedBody")}
            </p>
            <p className="text-muted-foreground">
              {copy("ruleAudit.discovery.interviewAccepted")} {existing.answer}
            </p>
          </div>
        ) : null}

        {isPendingReview && existing ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {copy("ruleAudit.discovery.interviewPending")} {existing.answer}
            </p>
            {existing.guardFailure ? (
              <p role="alert" className="text-sm text-destructive">
                {copy("ruleAudit.discovery.interviewAmbiguous")}
              </p>
            ) : null}
            {canEdit && reviewComplete ? (
              <SuggestedAnswerDecision
                canContinue={false}
                hasPendingProposal
                canConfirmPending={
                  !existing.guardFailure && caseRevision !== undefined
                }
                canReview={caseRevision !== undefined}
                isReviewPending={isReviewPending}
                onConfirmPending={() => onConfirm(existing.proposalId)}
                onRejectPending={() => onReject(existing.proposalId)}
              />
            ) : null}
          </div>
        ) : null}

        {isRejected ? (
          <div role="status" className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              {copy("ruleAudit.discovery.contextRejectedBody")}
            </p>
            <p className="text-muted-foreground">
              {copy("ruleAudit.discovery.interviewRejected")}
            </p>
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-semibold text-foreground">
            {copy("ruleAudit.discovery.evidenceProvenanceTitle")}
          </p>
          {provenance.length > 0 ? (
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
              {provenance.map((item) => (
                <li key={item.rangeId} className="font-mono">
                  {item.path}:{item.startLine}-{item.endLine}
                  {item.symbol ? ` (${item.symbol})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {copy("ruleAudit.discovery.evidenceMissing")}
            </p>
          )}
        </div>

        {canEdit && reviewComplete && (!existing || isRejected) ? (
          <DiscoveryContextQuestionForm
            entry={entry}
            disabled={!reviewComplete}
            isPending={isSubmitPending}
            submitLabelKey={
              isRejected
                ? "ruleAudit.discovery.confirmCorrectedAnswer"
                : "ruleAudit.discovery.submitAnswer"
            }
            placeholderKey={
              isRejected
                ? "ruleAudit.discovery.correctedAnswerPlaceholder"
                : "ruleAudit.discovery.answerPlaceholder"
            }
            onSubmitAnswer={onSubmitAnswer}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
