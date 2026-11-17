"use client";

import { useMemo, useRef, useState } from "react";
import {
  ASSESSMENT_DISCOVERY_RUN_STATUSES,
  DISCOVERY_RULE_CANDIDATE_STATES,
} from "@lcsp/contracts/assessment-domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useAssessmentDiscoveryLatestQuery,
  useAssessmentDiscoveryCandidatesQuery,
  useAssessmentDiscoveryUseCasesQuery,
  useStartAssessmentDiscovery,
} from "@/lib/api/assessment-discovery-queries";

import { copy } from "../../utils/conversation-copy";

type RuleLabel = {
  assessmentRuleId: string;
  concept: string;
};

/**
 * Business purpose: Let customers understand source Discovery and rule candidates before choosing audit scope.
 * Business rules:
 * - Discovery is explicitly started by the customer and never selects or decides a rule.
 * - Preview is bounded; missing and unlisted candidates cannot imply legal non-applicability.
 * - A failed request keeps its stable key for retry; a completed failed run uses a new key.
 * Execution flow:
 * 1. Restore latest pin-bound run, allowing refresh and server-side polling during a scan.
 * 2. Start discovery only when the user requests it and no selected audit exists.
 * 3. Page the entire available unresolved-question inventory on demand, and explain gaps/candidates without selecting rules.
 * Failure cases:
 * - API, ownership, worker and incomplete-coverage failures are explicit without fabricated results.
 * Side effects:
 * - May enqueue one deterministic scan; never creates a rule audit or compliance decision.
 */
export function AssessmentDiscoveryOverview({
  assessmentId,
  rules,
  canDiscover,
}: {
  assessmentId: string;
  rules: RuleLabel[];
  canDiscover: boolean;
}) {
  const latest = useAssessmentDiscoveryLatestQuery(assessmentId);
  const start = useStartAssessmentDiscovery(assessmentId);
  const retryKey = useRef<string | null>(null);
  const [visibleQuestionCount, setVisibleQuestionCount] = useState(10);
  const ruleNames = useMemo(
    () => new Map(rules.map((rule) => [rule.assessmentRuleId, rule.concept])),
    [rules],
  );
  const run = latest.data?.available ? latest.data.run : null;
  const candidatePages = useAssessmentDiscoveryCandidatesQuery(
    assessmentId,
    run?.runId ?? null,
    run?.discovery.available === true,
  );
  const questionPages = useAssessmentDiscoveryUseCasesQuery(
    assessmentId,
    run?.runId ?? null,
    run?.discovery.available === true,
  );
  const running =
    run?.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.queued ||
    run?.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.running;
  const available = run?.discovery.available ? run.discovery.discovery : null;
  const visibleCandidates =
    candidatePages.data?.pages.flatMap((page) => page.items) ??
    available?.preview.ruleCandidates ??
    [];
  const openQuestions = Array.from(
    new Set(
      (
        questionPages.data?.pages.flatMap((page) => page.items) ??
        available?.preview.aiUseCases ??
        []
      ).flatMap((useCase) => useCase.unresolvedQuestions),
    ),
  );
  const visibleQuestions = openQuestions.slice(0, visibleQuestionCount);
  const canExpandQuestions =
    openQuestions.length > visibleQuestionCount ||
    questionPages.hasNextPage === true;
  const showStart = canDiscover && !running;

  /**
   * Business purpose: Enqueue the customer's explicit source discovery without altering rule selection.
   * Business rules:
   * - Exact retries preserve an idempotency UUID; after a recorded failed run a fresh UUID starts a new attempt.
   * Execution flow:
   * 1. Reuse or mint a stable retry key and submit the command.
   * 2. Clear that key only once the API accepts a durable run.
   * Failure cases:
   * - Preserve key and visible error on transport failure; no optimistic discovery is fabricated.
   * Side effects:
   * - Starts one owner-authorized scanner run and refreshes discovery query state.
   */
  async function startDiscovery() {
    retryKey.current ??= crypto.randomUUID();
    try {
      await start.mutateAsync(retryKey.current);
      retryKey.current = null;
    } catch {
      // Stable key remains for an exact retry.
    }
  }

  return (
    <Card data-slot="assessment-discovery-overview">
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="text-base">
          {copy("ruleAudit.discovery.title")}
        </CardTitle>
        <CardDescription>
          {copy("ruleAudit.discovery.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {showStart ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={start.isPending}
            onClick={() => void startDiscovery()}
          >
            {copy(
              run?.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.failed
                ? "ruleAudit.discovery.retry"
                : "ruleAudit.discovery.start",
            )}
          </Button>
        ) : null}
        {latest.isError || start.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {copy("ruleAudit.discovery.error")}
            </AlertDescription>
          </Alert>
        ) : null}
        {running ? (
          <p role="status" className="text-sm text-muted-foreground">
            {copy("ruleAudit.discovery.running")}
          </p>
        ) : null}
        {run?.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.failed ? (
          <Alert role="status">
            <AlertDescription>
              {copy("ruleAudit.discovery.failed")}
            </AlertDescription>
          </Alert>
        ) : null}
        {available ? (
          <div className="space-y-3 text-sm">
            <p role="status">
              {copy("ruleAudit.discovery.summary", {
                useCases: available.aiUseCaseCount,
                candidates: available.ruleCandidateCount,
                gaps: available.knownGapCount,
              })}
            </p>
            <p className="text-muted-foreground">
              {copy("ruleAudit.discovery.investigationOnly")}
            </p>
            {questionPages.isError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {copy("ruleAudit.discovery.error")}
                </AlertDescription>
              </Alert>
            ) : null}
            {openQuestions.length > 0 || questionPages.hasNextPage ? (
              <section
                aria-label={copy("ruleAudit.discovery.contextQuestions")}
                className="space-y-2"
              >
                <p className="font-medium">
                  {copy("ruleAudit.discovery.contextQuestions")}
                </p>
                <p className="text-muted-foreground">
                  {copy("ruleAudit.discovery.contextAdvisory")}
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {visibleQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
                {canExpandQuestions ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={questionPages.isFetchingNextPage}
                    onClick={() => {
                      if (openQuestions.length > visibleQuestionCount) {
                        setVisibleQuestionCount((count) => count + 10);
                      } else {
                        void questionPages.fetchNextPage();
                      }
                    }}
                  >
                    {copy("ruleAudit.discovery.loadMore")}
                  </Button>
                ) : null}
              </section>
            ) : null}
            {candidatePages.isError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {copy("ruleAudit.discovery.candidateLoadFailed")}
                </AlertDescription>
              </Alert>
            ) : null}
            {available.ruleCandidateCount > 0 ? (
              <div className="space-y-2">
                <p className="font-medium">
                  {copy(
                    candidatePages.isSuccess && !candidatePages.hasNextPage
                      ? "ruleAudit.discovery.allCandidates"
                      : "ruleAudit.discovery.preview",
                    {
                      shown: visibleCandidates.length,
                      total: available.ruleCandidateCount,
                    },
                  )}
                </p>
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {visibleCandidates.map((candidate) => (
                    <li
                      key={candidate.assessmentRuleId}
                      className="rounded-lg border p-3"
                    >
                      <p className="font-medium">
                        {ruleNames.get(candidate.assessmentRuleId) ??
                          candidate.assessmentRuleId}
                      </p>
                      <p className="text-muted-foreground">
                        {candidate.state ===
                        DISCOVERY_RULE_CANDIDATE_STATES.needsContext
                          ? copy("ruleAudit.discovery.needsContext")
                          : copy("ruleAudit.discovery.candidate")}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {candidate.rationale}
                      </p>
                    </li>
                  ))}
                </ul>
                {candidatePages.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={candidatePages.isFetchingNextPage}
                    onClick={() => void candidatePages.fetchNextPage()}
                  >
                    {copy("ruleAudit.discovery.loadMore")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground">
                {copy("ruleAudit.discovery.noCandidates")}
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
