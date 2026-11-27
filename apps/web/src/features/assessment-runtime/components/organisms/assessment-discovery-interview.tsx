"use client";

import { useMemo } from "react";
import {
  DISCOVERY_INTERVIEW_PROPOSAL_STATUSES,
  DISCOVERY_INTERVIEW_REVIEW_ACTIONS,
} from "@lcsp/contracts/assessment-domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  useDiscoveryInterviewPageQuery,
  useReviewDiscoveryInterviewAnswer,
  useSubmitDiscoveryInterviewAnswer,
} from "@/lib/api/assessment-discovery-interview-queries";
import {
  DiscoveryContextQuestionForm,
  type DiscoveryContextQuestion,
} from "../molecules/discovery-context-question";
import { copy } from "../../utils/conversation-copy";

/**
 * Business purpose: Turn source-generated missing-context questions into owner-reviewed operational facts before audit selection.
 * Business rules:
 * - Scanner questions are advisory; a submitted answer stays PENDING_REVIEW until explicit owner confirmation.
 * - Ambiguous answers cannot be confirmed and should be rejected/replaced.
 * - A partial proposal ledger is never taken as proof that a question has not already been answered.
 * Execution flow:
 * 1. Load the full bounded proposal inventory and match exact use-case/question identities.
 * 2. Show draft entry, pending confirmation/rejection, or accepted status for each question.
 * 3. Revalidate current case revision and refresh candidate recommendations after confirmation.
 * Failure cases:
 * - Authorization, stale revision, pagination or ambiguous answer failures render errors without optimistic success.
 * Side effects:
 * - May create proposed answers, confirm accepted facts, or reject untrusted proposals; cannot select audit rules.
 */
export function AssessmentDiscoveryInterview({
  assessmentId,
  runId,
  questions,
  canEdit,
}: {
  assessmentId: string;
  runId: string;
  questions: DiscoveryContextQuestion[];
  canEdit: boolean;
}) {
  const history = useDiscoveryInterviewPageQuery(assessmentId, runId, true);
  const submit = useSubmitDiscoveryInterviewAnswer(assessmentId, runId);
  const review = useReviewDiscoveryInterviewAnswer(assessmentId, runId);
  const records = history.data?.pages.flatMap((page) => page.items) ?? [];
  const reviewComplete = history.isSuccess && !history.hasNextPage;
  const caseRevision = history.data?.pages[0]?.caseRevision;

  const latestByQuestion = useMemo(() => {
    const latest = new Map<string, (typeof records)[number]>();
    for (const item of records) {
      latest.set(`${item.useCaseId}::${item.question}`, item);
    }
    return latest;
  }, [records]);

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
          return (
            <li
              key={`${entry.useCaseId}::${entry.question}`}
              className="space-y-2 rounded-lg border p-3"
            >
              {/* Keep the visible feature separate from the exact question submitted to the API. */}
              <p className="text-sm text-muted-foreground">{entry.useCaseName}</p>
              <p className="font-medium">{entry.question}</p>
              {existing?.status ===
              DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.accepted ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {copy("ruleAudit.discovery.interviewAccepted")}{" "}
                  {existing.answer}
                </p>
              ) : null}
              {existing?.status ===
              DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {copy("ruleAudit.discovery.interviewPending")}{" "}
                    {existing.answer}
                  </p>
                  {existing.guardFailure ? (
                    <p role="alert" className="text-sm text-destructive">
                      {copy("ruleAudit.discovery.interviewAmbiguous")}
                    </p>
                  ) : null}
                  {canEdit && reviewComplete ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          review.isPending ||
                          Boolean(existing.guardFailure) ||
                          caseRevision === undefined
                        }
                        onClick={() =>
                          void reviewProposal(
                            existing.proposalId,
                            DISCOVERY_INTERVIEW_REVIEW_ACTIONS.accept,
                          )
                        }
                      >
                        {copy("ruleAudit.discovery.interviewConfirm")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          review.isPending || caseRevision === undefined
                        }
                        onClick={() =>
                          void reviewProposal(
                            existing.proposalId,
                            DISCOVERY_INTERVIEW_REVIEW_ACTIONS.reject,
                          )
                        }
                      >
                        {copy("ruleAudit.discovery.interviewReject")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {existing?.status ===
              DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.rejected ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {copy("ruleAudit.discovery.interviewRejected")}
                </p>
              ) : null}
              {canEdit &&
              reviewComplete &&
              (!existing ||
                existing.status ===
                  DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.rejected) ? (
                <DiscoveryContextQuestionForm
                  entry={entry}
                  disabled={!reviewComplete}
                  isPending={submit.isPending}
                  onSubmitAnswer={async (answer) => {
                    await submit.mutateAsync(answer);
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
