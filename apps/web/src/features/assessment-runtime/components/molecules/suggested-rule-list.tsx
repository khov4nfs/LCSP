"use client";

import {
  DISCOVERY_RULE_CANDIDATE_STATES,
  type AssessmentDiscoveryRunView,
} from "@lcsp/contracts/assessment-domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SUGGESTED_RULE_BADGE_KINDS,
  resolveEvidenceProvenance,
  resolveSuggestedRuleBadgeKind,
} from "../../utils/discovery-interaction";
import { copy } from "../../utils/conversation-copy";

type CandidateItem = Extract<
  AssessmentDiscoveryRunView["discovery"],
  { available: true }
>["discovery"]["preview"]["ruleCandidates"][number];

type PreviewRange = Extract<
  AssessmentDiscoveryRunView["discovery"],
  { available: true }
>["discovery"]["preview"]["ranges"][number];

const BADGE_CLASS_BY_KIND: Record<
  (typeof SUGGESTED_RULE_BADGE_KINDS)[keyof typeof SUGGESTED_RULE_BADGE_KINDS],
  string
> = {
  [SUGGESTED_RULE_BADGE_KINDS.confirmed]:
    "border-status-success-border bg-status-success-bg text-status-success",
  [SUGGESTED_RULE_BADGE_KINDS.review]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [SUGGESTED_RULE_BADGE_KINDS.needsContext]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [SUGGESTED_RULE_BADGE_KINDS.suggested]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
};

const BADGE_KEY_BY_KIND: Record<
  (typeof SUGGESTED_RULE_BADGE_KINDS)[keyof typeof SUGGESTED_RULE_BADGE_KINDS],
  string
> = {
  [SUGGESTED_RULE_BADGE_KINDS.confirmed]:
    "ruleAudit.discovery.suggestedRulesBadgeConfirmed",
  [SUGGESTED_RULE_BADGE_KINDS.review]:
    "ruleAudit.discovery.suggestedRulesBadgeReview",
  [SUGGESTED_RULE_BADGE_KINDS.needsContext]:
    "ruleAudit.discovery.suggestedRulesBadgeNeedsContext",
  [SUGGESTED_RULE_BADGE_KINDS.suggested]:
    "ruleAudit.discovery.suggestedRulesBadgeSuggested",
};

/**
 * Business purpose: Display Discovery-suggested legal rules separately from customer-selected or applicable rules.
 * Business rules:
 * - Suggestions are investigative leads (`authorizesAssessment: false`) and never grant applicability or start execution.
 * - Populating the customer's editable rule selection requires an explicit button click after all candidate pages load.
 * Execution flow:
 * 1. Render candidate list with status badges, rationale, and source evidence provenance.
 * 2. Render explicit "Select suggested rules" and "Load more" controls when permitted.
 * Failure cases:
 * - Candidate pagination errors and zero-candidate runs render explicit alerts/notices without implying non-applicability.
 * Side effects:
 * - Explicit clicks invoke `onChooseCandidates` or `onLoadMore`.
 */
export function SuggestedRuleList({
  candidates,
  totalCandidates,
  allPagesLoaded,
  hasNextPage,
  isFetchingNextPage,
  loadFailed,
  ruleNames,
  previewRanges,
  hasRejectedContext,
  canChooseCandidates,
  selectableCandidateIds,
  onChooseCandidates,
  onLoadMore,
}: {
  candidates: CandidateItem[];
  totalCandidates: number;
  allPagesLoaded: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadFailed: boolean;
  ruleNames: Map<string, string>;
  previewRanges: PreviewRange[] | undefined;
  hasRejectedContext: boolean;
  canChooseCandidates: boolean;
  selectableCandidateIds: string[];
  onChooseCandidates: (assessmentRuleIds: string[]) => void;
  onLoadMore: () => void;
}) {
  return (
    <Card data-slot="suggested-rule-list" className="border-border bg-card">
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="text-base">
          {copy("ruleAudit.discovery.suggestedRulesTitle")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {copy("ruleAudit.discovery.investigationOnly")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadFailed ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {copy("ruleAudit.discovery.candidateLoadFailed")}
            </AlertDescription>
          </Alert>
        ) : null}

        {totalCandidates > 0 ? (
          <>
            <p className="text-xs font-medium text-muted-foreground">
              {copy(
                allPagesLoaded
                  ? "ruleAudit.discovery.allCandidates"
                  : "ruleAudit.discovery.preview",
                {
                  shown: candidates.length,
                  total: totalCandidates,
                },
              )}
            </p>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {candidates.map((candidate) => {
                const badgeKind = resolveSuggestedRuleBadgeKind({
                  candidateState: candidate.state,
                  supportingFactCount: candidate.supportingFactIds.length,
                  unresolvedConditionCount:
                    candidate.unresolvedConditions.length,
                  hasRejectedContext,
                });
                const provenance = resolveEvidenceProvenance(
                  candidate.supportingRangeIds,
                  previewRanges,
                );
                return (
                  <li
                    key={candidate.assessmentRuleId}
                    className="space-y-1.5 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {ruleNames.get(candidate.assessmentRuleId) ??
                          candidate.assessmentRuleId}
                      </p>
                      <Badge
                        variant="outline"
                        className={BADGE_CLASS_BY_KIND[badgeKind]}
                      >
                        {copy(BADGE_KEY_BY_KIND[badgeKind])}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {candidate.state ===
                      DISCOVERY_RULE_CANDIDATE_STATES.needsContext
                        ? copy("ruleAudit.discovery.needsContext")
                        : copy("ruleAudit.discovery.candidate")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {candidate.rationale}
                    </p>
                    {provenance.length > 0 ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        {provenance
                          .map(
                            (item) =>
                              `${item.path}:${item.startLine}-${item.endLine}`,
                          )
                          .join(", ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              {canChooseCandidates && selectableCandidateIds.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChooseCandidates(selectableCandidateIds)}
                >
                  {copy("ruleAudit.discovery.selectCandidateRules")}
                </Button>
              ) : null}
              {hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isFetchingNextPage}
                  onClick={onLoadMore}
                >
                  {copy("ruleAudit.discovery.loadMore")}
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {copy("ruleAudit.discovery.noCandidates")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
