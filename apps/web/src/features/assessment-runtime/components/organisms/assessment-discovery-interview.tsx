"use client";

import { useEffect, useMemo } from "react";
import {
  DISCOVERY_INTERVIEW_REVIEW_ACTIONS,
  type AssessmentDiscoveryRunView,
  type DiscoveryInterviewProposal,
} from "@lcsp/contracts/assessment-domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  useDiscoveryInterviewPageQuery,
  useReviewDiscoveryInterviewAnswer,
  useSubmitDiscoveryInterviewAnswer,
} from "@/lib/api/assessment-discovery-interview-queries";
import { resolveEvidenceProvenance } from "../../utils/discovery-interaction";
import { copy } from "../../utils/conversation-copy";
import { ContextQuestionCard } from "../molecules/context-question-card";
import type { DiscoveryContextQuestion } from "../molecules/discovery-context-question";

type PreviewRange = Extract<
  AssessmentDiscoveryRunView["discovery"],
  { available: true }
>["discovery"]["preview"]["ranges"][number];

export type DiscoveryContextQuestionWithRange = DiscoveryContextQuestion & {
  rangeIds?: readonly string[];
};

/**
 * Business purpose: Turn source-generated missing-context questions into owner-reviewed operational facts before audit selection.
 * Business rules:
 * - Scanner questions are advisory; a submitted answer stays PENDING_REVIEW until explicit owner confirmation.
 * - Ambiguous answers cannot be confirmed and should be rejected/replaced.
 * - A partial proposal ledger is never taken as proof that a question has not already been answered.
 * Execution flow:
 * 1. Load the full bounded proposal inventory and match exact use-case/question identities.
 * 2. Render each question inside a `ContextQuestionCard` with source evidence provenance and explicit confirm/reject/correct controls.
 * 3. Report authoritative review state upward so continuation is gated on confirmed system state.
 * Failure cases:
 * - Authorization, stale revision, pagination or ambiguous answer failures render errors without optimistic success.
 * Side effects:
 * - May create proposed answers, confirm accepted facts, or reject untrusted proposals; cannot select audit rules.
 */
export function AssessmentDiscoveryInterview({
  assessmentId,
  runId,
  questions,
  previewRanges,
  canEdit,
  onInterviewStateChange,
}: {
  assessmentId: string;
  runId: string;
  questions: DiscoveryContextQuestionWithRange[];
  previewRanges?: PreviewRange[];
  canEdit: boolean;
  onInterviewStateChange?: (state: {
    latestByQuestion: Map<string, DiscoveryInterviewProposal>;
    reviewComplete: boolean;
  }) => void;
}) {
  const history = useDiscoveryInterviewPageQuery(assessmentId, runId, true);
  const submit = useSubmitDiscoveryInterviewAnswer(assessmentId, runId);
  const review = useReviewDiscoveryInterviewAnswer(assessmentId, runId);
  const records = useMemo(
    () => history.data?.pages.flatMap((page) => page.items) ?? [],
    [history.data],
  );
  const reviewComplete = history.isSuccess && !history.hasNextPage;
  const caseRevision = history.data?.pages[0]?.caseRevision;

  const latestByQuestion = useMemo(() => {
    const latest = new Map<string, (typeof records)[number]>();
    for (const item of records) {
      latest.set(`${item.useCaseId}::${item.question}`, item);
    }
    return latest;
  }, [records]);

  useEffect(() => {
    onInterviewStateChange?.({ latestByQuestion, reviewComplete });
  }, [latestByQuestion, reviewComplete, onInterviewStateChange]);

  /**
   * Business purpose: Apply a customer's explicit review action without treating a pending answer as an accepted fact.
   * Business rules:
   * - The API owns optimistic revision validation, ambiguous-answer restrictions and immutable evidence creation.
   * Execution flow:
   * 1. Submit the proposal ID, action and current canonical case revision.
   * Failure cases:
   * - Missing or stale revisions leave the answer pending and surface an error.
   * Side effects:
   * - May confirm or reject one question answer and refresh its review history.
   */
  async function reviewProposal(
    proposalId: string,
    action: (typeof DISCOVERY_INTERVIEW_REVIEW_ACTIONS)[keyof typeof DISCOVERY_INTERVIEW_REVIEW_ACTIONS],
  ) {
    if (caseRevision === undefined) return;
    try {
      await review.mutateAsync({
        proposalId,
        review: { action, expectedCaseRevision: caseRevision },
      });
    } catch {
      // The mutation exposes its canonical problem to the error alert below.
    }
  }

  return (
    <section
      className="space-y-3"
      aria-label={copy("ruleAudit.discovery.interviewTitle")}
    >
      <p className="font-medium">
        {copy("ruleAudit.discovery.interviewTitle")}
      </p>
      <p className="text-muted-foreground">
        {copy("ruleAudit.discovery.interviewDescription")}
      </p>
      {history.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {copy("ruleAudit.discovery.interviewLoading")}
        </p>
      ) : null}
      {history.isError || submit.isError || review.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {copy("ruleAudit.discovery.interviewError")}
          </AlertDescription>
        </Alert>
      ) : null}
      {history.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {copy("ruleAudit.discovery.loadMoreHistory")}
        </Button>
      ) : null}
      <ul className="space-y-3">
        {questions.map((entry) => {
          const existing = latestByQuestion.get(
            `${entry.useCaseId}::${entry.question}`,
          );
          const provenance = resolveEvidenceProvenance(
            entry.rangeIds ?? [],
            previewRanges,
          );
          return (
            <li key={`${entry.useCaseId}::${entry.question}`}>
              <ContextQuestionCard
                entry={entry}
                existing={existing}
                provenance={provenance}
                canEdit={canEdit}
                reviewComplete={reviewComplete}
                caseRevision={caseRevision}
                isSubmitPending={submit.isPending}
                isReviewPending={review.isPending}
                onSubmitAnswer={async (answer) => {
                  await submit.mutateAsync(answer);
                }}
                onConfirm={(proposalId) =>
                  void reviewProposal(
                    proposalId,
                    DISCOVERY_INTERVIEW_REVIEW_ACTIONS.accept,
                  )
                }
                onReject={(proposalId) =>
                  void reviewProposal(
                    proposalId,
                    DISCOVERY_INTERVIEW_REVIEW_ACTIONS.reject,
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
