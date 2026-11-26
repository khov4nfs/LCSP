import { ScaleIcon } from "lucide-react";

import { CoverageDonut } from "@/components/molecules/coverage-donut";
import { DASHBOARD_SURFACES } from "@/components/types/dashboard-primitives.types";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";

import { SourceVersionSummary } from "../molecules/source-version-summary";

export interface OutcomeCounts {
  compliant: number;
  nonCompliant: number;
  needsInfo: number;
  notRequested: number;
}

/**
 * Business purpose: Render the Overview tab of the Assessment Decision Workspace matching Figma Frame 20 (`1748:12843`).
 * Business rules:
 * - Reuses M03's `CoverageDonut` (`surface={DASHBOARD_SURFACES.dark}`) and `SourceVersionSummary` so outcome counts match evaluated rules.
 * - Shows the `Attention required` card only when an open human request exists.
 * Execution flow:
 * 1. Compute outcome totals and donut segments from actual `OutcomeCounts`.
 * 2. Render `Assessment results` Midnight-Teal hero card + `Attention required` warning card (when open request exists).
 * 3. Render `Assessment scope` card (`SourceVersionSummary`) + `Evaluate selected rules` card.
 * Failure cases:
 * - Zero total rules renders `0 / 0` without division-by-zero.
 * Side effects:
 * - Tab-switch callbacks (`onReviewFindings`, `onAnswerRequest`, `onViewSourceEvidence`, `onAuditSelectedRules`).
 */
export function AssessmentOutcomeSummary({
  assessmentId,
  counts,
  openRequestQuestion,
  repositoryName,
  commitSha,
  legalSourceVersion,
  onReviewFindings,
  onAnswerRequest,
  onViewSourceEvidence,
  onAuditSelectedRules,
}: {
  assessmentId: string;
  counts: OutcomeCounts;
  openRequestQuestion?: string | null;
  repositoryName?: string | null;
  commitSha?: string | null;
  legalSourceVersion?: string | null;
  onReviewFindings: () => void;
  onAnswerRequest?: () => void;
  onViewSourceEvidence: () => void;
  onAuditSelectedRules?: () => void;
}) {
  const readyCount = counts.compliant + counts.nonCompliant;
  const totalCount =
    counts.compliant +
    counts.nonCompliant +
    counts.needsInfo +
    counts.notRequested;

  const segments = [
    {
      key: "compliant",
      label: resolveAppMessage("pages.workspace.tracking.statusCompleted"),
      count: counts.compliant,
      color: "var(--outcome-compliant)",
    },
    {
      key: "nonCompliant",
      label: resolveAppMessage("pages.workspace.tracking.statusFailed"),
      count: counts.nonCompliant,
      color: "var(--outcome-non-compliant)",
    },
    {
      key: "needsInfo",
      label: resolveAppMessage("pages.workspace.tracking.statusNeedsInfo"),
      count: counts.needsInfo,
      color: "var(--outcome-unresolved)",
    },
    {
      key: "notRequested",
      label: resolveAppMessage("pages.workspace.tracking.statusRunning"),
      count: counts.notRequested,
      color: "var(--status-draft)",
    },
  ];

  const ratioLabel = resolveAppMessage(
    "pages.assessmentWorkspace.overview.resultsRatio",
  )
    .replace("{ready}", readyCount.toLocaleString(appLocale))
    .replace("{total}", totalCount.toLocaleString(appLocale));

  const compliantLabel = resolveAppMessage(
    "pages.assessmentWorkspace.overview.compliantSummary",
  )
    .replace("{compliant}", counts.compliant.toLocaleString(appLocale))
    .replace("{nonCompliant}", counts.nonCompliant.toLocaleString(appLocale));

  const pendingLabel = resolveAppMessage(
    "pages.assessmentWorkspace.overview.pendingSummary",
  )
    .replace("{needsInfo}", counts.needsInfo.toLocaleString(appLocale))
    .replace("{notRequested}", counts.notRequested.toLocaleString(appLocale));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <section
          aria-label={resolveAppMessage(
            "pages.assessmentWorkspace.overview.resultsTitle",
          )}
          className="rounded-2xl bg-linear-to-r from-bento-from to-bento-to p-6 text-bento-foreground shadow-sm"
        >
          <h2 className="text-xl font-semibold text-bento-heading">
            {resolveAppMessage(
              "pages.assessmentWorkspace.overview.resultsTitle",
            )}
          </h2>

          <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <CoverageDonut
              segments={segments}
              total={totalCount}
              centerValue={`${readyCount} / ${totalCount}`}
              centerLabel={resolveAppMessage(
                "pages.assessmentWorkspace.overview.resultsReadyLabel",
              )}
              size={152}
              strokeWidth={14}
              surface={DASHBOARD_SURFACES.dark}
            />

            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-base font-medium text-bento-heading">
                {ratioLabel}
              </p>
              <div className="space-y-1 text-sm text-bento-muted">
                <p>{compliantLabel}</p>
                <p>{pendingLabel}</p>
              </div>

              {totalCount > 0 ? (
                <div
                  aria-hidden="true"
                  className="flex h-2 w-full overflow-hidden rounded-full bg-bento-card"
                >
                  {segments.map((segment) =>
                    segment.count > 0 ? (
                      <span
                        key={segment.key}
                        style={{
                          width: `${(segment.count / totalCount) * 100}%`,
                          backgroundColor: segment.color,
                        }}
                      />
                    ) : null,
                  )}
                </div>
              ) : null}

              <div className="pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onReviewFindings}
                  className="bg-brand-mint text-brand-deep hover:bg-brand-mint/90"
                >
                  {resolveAppMessage(
                    "pages.assessmentWorkspace.overview.reviewFindings",
                  )}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section
          aria-label={resolveAppMessage(
            "pages.assessmentWorkspace.overview.scopeTitle",
          )}
          className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs"
        >
          <span
            aria-hidden="true"
            className="absolute top-4 left-0 h-9 w-1 rounded-r-xs bg-status-info"
          />
          <div className="mb-3 flex items-center justify-between gap-2 pl-2">
            <h3 className="text-lg font-semibold text-foreground">
              {resolveAppMessage(
                "pages.assessmentWorkspace.overview.scopeTitle",
              )}
            </h3>
            <ScaleIcon
              className="size-5 text-status-info"
              aria-hidden="true"
            />
          </div>
          <div className="pl-2">
            <SourceVersionSummary
              assessmentId={assessmentId}
              repositoryName={repositoryName}
              commitSha={commitSha}
              legalSourceVersion={legalSourceVersion}
              onViewSourceEvidence={onViewSourceEvidence}
            />
          </div>
        </section>
      </div>

      <div className="space-y-4">
        {openRequestQuestion ? (
          <section
            aria-label={resolveAppMessage(
              "pages.assessmentWorkspace.overview.attentionTitle",
            )}
            className="relative overflow-hidden rounded-2xl border border-status-warning-border bg-metric-attention-bg p-5 shadow-xs"
          >
            <span
              aria-hidden="true"
              className="absolute top-4 left-0 h-9 w-1 rounded-r-xs bg-status-warning"
            />
            <div className="space-y-2 pl-2">
              <h3 className="text-lg font-semibold text-metric-attention-ink">
                {resolveAppMessage(
                  "pages.assessmentWorkspace.overview.attentionTitle",
                )}
              </h3>
              <p className="text-base font-medium text-metric-attention-ink">
                {openRequestQuestion}
              </p>
              <p className="text-sm text-metric-attention-muted">
                {resolveAppMessage(
                  "pages.assessmentWorkspace.overview.attentionBlocking",
                )}
              </p>
              {onAnswerRequest ? (
                <div className="pt-2">
                  <Button type="button" onClick={onAnswerRequest}>
                    {resolveAppMessage(
                      "pages.assessmentWorkspace.overview.answerRequest",
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section
          aria-label={resolveAppMessage(
            "pages.assessmentWorkspace.overview.evaluateTitle",
          )}
          className="relative overflow-hidden rounded-2xl border border-brand/30 bg-brand-mint/45 p-5 shadow-xs"
        >
          <span
            aria-hidden="true"
            className="absolute top-4 left-0 h-9 w-1 rounded-r-xs bg-brand"
          />
          <div className="space-y-2 pl-2">
            <h3 className="text-lg font-semibold text-foreground">
              {resolveAppMessage(
                "pages.assessmentWorkspace.overview.evaluateTitle",
              )}
            </h3>
            <p className="text-sm font-medium text-foreground">
              {resolveAppMessage(
                "pages.assessmentWorkspace.overview.evaluateSubtitle",
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {resolveAppMessage(
                "pages.assessmentWorkspace.overview.evaluateHint",
              )}
            </p>
            {onAuditSelectedRules ? (
              <div className="pt-2">
                <Button type="button" onClick={onAuditSelectedRules}>
                  {resolveAppMessage(
                    "pages.assessmentWorkspace.overview.auditSelectedRules",
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
