import Link from "next/link";
import { TRACKING_RULE_OUTCOMES } from "@lcsp/contracts/assessment-domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { AssessmentReportActions } from "@/features/assessment-runtime/components/molecules/assessment-report-actions";
import { TrackingFact } from "./tracking-fact";
import {
  TrackingFreshnessBadge,
  TrackingNotEvaluatedBadge,
  TrackingOutcomeBadge,
  TrackingTrustBadge,
} from "./tracking-status-badge";
import {
  formatTrackingDate,
  trackingMessage,
} from "../../utils/tracking-display";
import { assessmentSummaryKey } from "../../utils/assessment-summary";
import type { AssessmentTrackingCardProps } from "../../types/tracking-ui.types";

export function AssessmentTrackingCard({ item }: AssessmentTrackingCardProps) {
  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">
          <Link
            className="hover:underline"
            href={`/assessments/${encodeURIComponent(item.assessmentId)}`}
          >
            {item.name}
          </Link>
        </CardTitle>
        <p className="truncate text-xs text-muted-foreground">
          {item.repository.owner && item.repository.name
            ? `${item.repository.owner}/${item.repository.name}`
            : trackingMessage("repository")}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {trackingMessage(assessmentSummaryKey(item))}
        </p>
        <div className="flex flex-wrap gap-2">
          {item.compliance.compliantCount > 0 ? (
            <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.COMPLIANT} />
          ) : null}
          {item.compliance.nonCompliantCount > 0 ? (
            <TrackingOutcomeBadge
              outcome={TRACKING_RULE_OUTCOMES.NON_COMPLIANT}
            />
          ) : null}
          {item.compliance.notApplicableCount > 0 ? (
            <TrackingOutcomeBadge
              outcome={TRACKING_RULE_OUTCOMES.NOT_APPLICABLE}
            />
          ) : null}
          {!item.ruleSet.ruleSetVersionId ? (
            <TrackingNotEvaluatedBadge />
          ) : item.compliance.unresolvedCount > 0 ? (
            <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.UNRESOLVED} />
          ) : null}
          {item.ruleSet.ruleSetVersionId &&
          Object.values(item.compliance).every((value) => value === 0) ? (
            <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.UNRESOLVED} />
          ) : null}
        </div>
        <TrackingTrustBadge status={item.trust.trustStatus} />
        <TrackingFreshnessBadge status={item.repository.freshnessStatus} />
        <Collapsible className="rounded-md border px-3 py-2 text-sm">
          <CollapsibleTrigger className="w-full justify-between font-medium">
            {trackingMessage("detail")}
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <dl className="mt-2 space-y-2 text-xs">
              <TrackingFact
                label={trackingMessage("assessedCommit")}
                value={item.repository.pinnedCommit}
                fallbackWhenEmpty={false}
              />
              <TrackingFact
                label={trackingMessage("latestObservedCommit")}
                value={item.repository.latestCommit}
                fallbackWhenEmpty={false}
              />
              <TrackingFact
                label={trackingMessage("ruleSet")}
                value={item.ruleSet.ruleSetVersion ?? item.ruleSet.ruleSetName}
                fallbackWhenEmpty={false}
              />
              <TrackingFact
                label={trackingMessage("observedAt")}
                value={
                  item.repository.observedAt
                    ? formatTrackingDate(item.repository.observedAt)
                    : trackingMessage("freshnessState.FRESHNESS_UNKNOWN")
                }
                fallbackWhenEmpty={false}
              />
            </dl>
          </CollapsiblePanel>
        </Collapsible>
        {item.report.isReady ? (
          <AssessmentReportActions
            assessmentId={item.assessmentId}
            artifactId={item.report.finalReportArtifactId!}
          />
        ) : (
          <Button
            render={
              <Link
                href={`/assessments/${encodeURIComponent(item.assessmentId)}`}
              />
            }
            variant="outline"
            nativeButton={false}
          >
            {trackingMessage("openAssessment")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
