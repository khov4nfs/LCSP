"use client";

import { Button } from "@/components/ui/button";
import { copy } from "../../utils/conversation-copy";

/**
 * Business purpose: Render the explicit Discovery decision action bar matching Figma Frame 107 and its Confirm/Reject states.
 * Business rules:
 * - "Continue to rule selection" is enabled only when the actual discovery state permits continuation.
 * - Confirm and Reject actions remain explicit owner controls and never auto-select or auto-execute audit rules.
 * Execution flow:
 * 1. Render Confirm/Reject actions when a pending proposal is under review.
 * 2. Render "Continue to rule selection" (disabled when `!canContinue`) and optional "Back to discovery" control.
 * 3. Display the authorization and confirmed-system-state hint and any continuation blocker message.
 * Failure cases:
 * - Missing `canContinue` disables continuation with an explicit screen-reader/visible explanation.
 * Side effects:
 * - Invokes caller-supplied review or navigation callbacks.
 */
export function SuggestedAnswerDecision({
  canContinue,
  hasPendingProposal,
  canConfirmPending,
  canReview,
  isReviewPending,
  isCorrectionMode,
  onConfirmPending,
  onRejectPending,
  onContinueToRuleSelection,
  onBackToDiscovery,
}: {
  canContinue: boolean;
  hasPendingProposal: boolean;
  canConfirmPending: boolean;
  canReview: boolean;
  isReviewPending: boolean;
  isCorrectionMode?: boolean;
  onConfirmPending?: () => void;
  onRejectPending?: () => void;
  onContinueToRuleSelection?: () => void;
  onBackToDiscovery?: () => void;
}) {
  return (
    <div
      data-slot="suggested-answer-decision"
      className="space-y-2 border-t border-border pt-3"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {hasPendingProposal && canReview && onConfirmPending ? (
          <Button
            type="button"
            disabled={isReviewPending || !canConfirmPending}
            onClick={onConfirmPending}
          >
            {copy("ruleAudit.discovery.interviewConfirm")}
          </Button>
        ) : null}
        {hasPendingProposal && canReview && onRejectPending ? (
          <Button
            type="button"
            variant="outline"
            disabled={isReviewPending}
            onClick={onRejectPending}
          >
            {copy("ruleAudit.discovery.interviewReject")}
          </Button>
        ) : null}
        {isCorrectionMode && onBackToDiscovery ? (
          <Button
            type="button"
            variant="outline"
            disabled={isReviewPending}
            onClick={onBackToDiscovery}
          >
            {copy("ruleAudit.discovery.backToDiscovery")}
          </Button>
        ) : null}
        {onContinueToRuleSelection ? (
          <Button
            type="button"
            variant={canContinue ? "default" : "outline"}
            disabled={!canContinue}
            onClick={onContinueToRuleSelection}
          >
            {copy("ruleAudit.discovery.continueToRuleSelection")}
          </Button>
        ) : null}
      </div>
      {!canContinue ? (
        <p role="status" className="text-xs text-muted-foreground">
          {copy("ruleAudit.discovery.continuationBlocked")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {copy("ruleAudit.discovery.decisionHint")}
      </p>
    </div>
  );
}
