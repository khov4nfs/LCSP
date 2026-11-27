"use client";

import { useState } from "react";
import type { TrackingUntrustedReason } from "@lcsp/contracts/assessment-domain";
import type { MessageKey } from "@lcsp/i18n";
import { CheckCircle2Icon, ChevronDownIcon } from "lucide-react";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackingSection } from "../molecules/tracking-section";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { TrackingFact } from "../molecules/tracking-fact";
import { appLocale } from "@/lib/locale";
import { useAdminTrackingOperationalQuery } from "@/lib/api/tracking-queries";
import { resolveAppMessage } from "@/lib/i18n";
import {
  formatTrackingDate,
  groupUsageByModel,
  type ModelUsageSummary,
} from "../../utils/tracking-display";
import { TrackingError } from "../molecules/tracking-error";
import {
  OperationsEventDetailDialog,
  type OperationsEventDetailItem,
} from "./operations-event-detail-dialog";
import { cn } from "@/lib/utils";

/**
 * Business purpose: Render the admin operations monitoring dashboard with semantic KPI cards, impacted assessments, usage reconciliation, execution anomalies, and event detail inspection.
 * Business rules:
 * - Displays only authoritative operational telemetry from useAdminTrackingOperationalQuery without synthetic audit events.
 * - Uses NextMetricCard (embedded, attention, ready) aligned to Figma Operations monitoring (Frames 55, 85).
 * Execution flow:
 * 1. Fetch operational health, impacted assessments, unreconciled usage, anomalies, and untrusted projections.
 * 2. Render KPI strip, sectioned queues, and OperationsEventDetailDialog when an operator inspects an item.
 * Failure cases:
 * - Error state renders TrackingError with explicit retry; empty queues render localized normal/empty states.
 * Side effects:
 * - Executes read-only operational query.
 */
export function AdminTrackingPage() {
  const query = useAdminTrackingOperationalQuery();
  const [selectedEvent, setSelectedEvent] =
    useState<OperationsEventDetailItem | null>(null);
  const data = query.data;
  return (
    <div className="space-y-6" data-component="AdminTrackingPage">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          {resolveAppMessage(
            "pages.workspace.tracking.adminTitle" as MessageKey,
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {resolveAppMessage(
            "pages.workspace.tracking.adminDescription" as MessageKey,
          )}
        </p>
      </header>
      {query.isError ? (
        <TrackingError onRetry={() => void query.refetch()} />
      ) : null}
      {query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton className="h-28" key={i} />
          ))}
        </div>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <NextMetricCard
              variant={
                data.platformHealth.totalFailedAssessments > 0
                  ? NEXT_METRIC_VARIANTS.attention
                  : NEXT_METRIC_VARIANTS.ready
              }
              label={resolveAppMessage(
                "pages.workspace.tracking.failedAssessments" as MessageKey,
              )}
              value={data.platformHealth.totalFailedAssessments.toLocaleString(
                appLocale,
              )}
              context={resolveAppMessage(
                "pages.workspace.tracking.adminTitle" as MessageKey,
              )}
            />
            <NextMetricCard
              variant={
                data.platformHealth.totalBlockedAssessments > 0
                  ? NEXT_METRIC_VARIANTS.attention
                  : NEXT_METRIC_VARIANTS.ready
              }
              label={resolveAppMessage(
                "pages.workspace.tracking.blockedAssessments" as MessageKey,
              )}
              value={data.platformHealth.totalBlockedAssessments.toLocaleString(
                appLocale,
              )}
              context={resolveAppMessage(
                "pages.workspace.tracking.adminTitle" as MessageKey,
              )}
            />
            <NextMetricCard
              variant={
                data.platformHealth.totalExecutionAnomalies > 0
                  ? NEXT_METRIC_VARIANTS.attention
                  : NEXT_METRIC_VARIANTS.ready
              }
              label={resolveAppMessage(
                "pages.workspace.tracking.executions" as MessageKey,
              )}
              value={data.platformHealth.totalExecutionAnomalies.toLocaleString(
                appLocale,
              )}
              context={resolveAppMessage(
                "pages.workspace.tracking.adminTitle" as MessageKey,
              )}
            />
            <NextMetricCard
              variant={NEXT_METRIC_VARIANTS.embedded}
              label={resolveAppMessage(
                "pages.workspace.tracking.usage" as MessageKey,
              )}
              value={data.platformHealth.totalUnreconciledUsageEvents.toLocaleString(
                appLocale,
              )}
              context={resolveAppMessage(
                "pages.workspace.tracking.adminTitle" as MessageKey,
              )}
            />
            <NextMetricCard
              variant={
                data.platformHealth.totalUntrustedProjections > 0
                  ? NEXT_METRIC_VARIANTS.attention
                  : NEXT_METRIC_VARIANTS.ready
              }
              label={resolveAppMessage(
                "pages.workspace.tracking.untrusted" as MessageKey,
              )}
              value={data.platformHealth.totalUntrustedProjections.toLocaleString(
                appLocale,
              )}
              context={resolveAppMessage(
                "pages.workspace.tracking.adminTitle" as MessageKey,
              )}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {resolveAppMessage(
              "pages.workspace.tracking.limitedRows" as MessageKey,
            )}{" "}
            {resolveAppMessage(
              "pages.workspace.tracking.generatedAt" as MessageKey,
            )}
            : {formatTrackingDate(data.generatedAt)}
          </p>
          <TrackingSection
            title={resolveAppMessage(
              "pages.workspace.tracking.customerImpact" as MessageKey,
            )}
          >
            {data.impactedAssessments.length ? (
              <div className="flex flex-col gap-3">
                {data.impactedAssessments.map((item) => (
                  <article
                    key={item.assessmentId}
                    className="rounded-lg border p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {resolveAppMessage(
                            "pages.workspace.tracking.affectedCustomer" as MessageKey,
                          )}
                          : {item.ownerId}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSelectedEvent({
                            title: item.name,
                            area: item.impactReason,
                            statusLabel:
                              item.executionState ?? item.lifecycleState ?? "",
                            statusVariant: "warning",
                            timestamp: formatTrackingDate(item.lastActivityAt),
                            actorOrTarget: item.ownerId,
                            summary: item.blockerReason ?? item.impactReason,
                          })
                        }
                      >
                        {resolveAppMessage(
                          "pages.workspace.tracking.detail" as MessageKey,
                        )}
                      </Button>
                    </div>
                    <Collapsible className="mt-2 text-sm">
                      <CollapsibleTrigger className="w-full justify-between">
                        {resolveAppMessage(
                          "pages.workspace.tracking.detail" as MessageKey,
                        )}
                        <ChevronDownIcon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
                        />
                      </CollapsibleTrigger>
                      <CollapsiblePanel>
                        <dl className="mt-2 space-y-1 text-xs">
                          <TrackingFact
                            label={resolveAppMessage(
                              "pages.workspace.tracking.executionState" as MessageKey,
                            )}
                            value={
                              item.executionState ?? item.lifecycleState ?? ""
                            }
                          />
                          <TrackingFact
                            label={resolveAppMessage(
                              "pages.workspace.tracking.anomaly" as MessageKey,
                            )}
                            value={item.impactReason}
                          />
                          <TrackingFact
                            label={resolveAppMessage(
                              "pages.workspace.tracking.detail" as MessageKey,
                            )}
                            value={item.blockerReason ?? ""}
                          />
                          <TrackingFact
                            label={resolveAppMessage(
                              "pages.workspace.tracking.updatedAt" as MessageKey,
                            )}
                            value={formatTrackingDate(item.lastActivityAt)}
                          />
                        </dl>
                      </CollapsiblePanel>
                    </Collapsible>
                  </article>
                ))}
              </div>
            ) : (
              <Empty />
            )}
          </TrackingSection>
          <TrackingSection
            title={resolveAppMessage(
              "pages.workspace.tracking.usage" as MessageKey,
            )}
          >
            {data.unreconciledUsage.length ? (
              <div className="flex flex-col gap-3">
                {groupUsageByModel(data.unreconciledUsage).map((summary) => (
                  <ModelUsageCard key={summary.model} summary={summary} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center">
                <CheckCircle2Icon className="size-8 text-status-success" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  {resolveAppMessage(
                    "pages.workspace.tracking.noOperationalItems" as MessageKey,
                  )}
                </p>
              </div>
            )}
          </TrackingSection>
          <TrackingSection
            title={resolveAppMessage(
              "pages.workspace.tracking.executions" as MessageKey,
            )}
          >
            {data.executionAnomalies.length ? (
              <div className="flex flex-col gap-3">
                {data.executionAnomalies.map((item) => (
                  <article
                    key={`${item.assessmentId}-${item.executionId ?? item.detectedAt}`}
                    className="rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive">
                          {item.anomalyType}
                        </Badge>
                        <span className="text-xs font-medium text-foreground">
                          {item.executionState}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatTrackingDate(item.detectedAt)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">
                          {resolveAppMessage(
                            "pages.workspace.tracking.duration" as MessageKey,
                          )}
                          :
                        </span>{" "}
                        <span className="font-medium text-foreground">
                          {item.durationSeconds === null
                            ? resolveAppMessage(
                                "pages.workspace.tracking.notAvailable" as MessageKey,
                              )
                            : `${item.durationSeconds} ${resolveAppMessage(
                                "pages.workspace.tracking.secondsUnit" as MessageKey,
                              )}`}
                        </span>
                      </div>
                      {item.rootAgentVersion ? (
                        <div>
                          <span className="text-muted-foreground">
                            {resolveAppMessage(
                              "pages.workspace.tracking.runtimeVersion" as MessageKey,
                            )}
                            :
                          </span>{" "}
                          <span className="font-medium text-foreground">
                            {item.rootAgentVersion}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center">
                <CheckCircle2Icon className="size-8 text-status-success" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  {resolveAppMessage(
                    "pages.workspace.tracking.noAnomalies" as MessageKey,
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {resolveAppMessage(
                    "pages.workspace.tracking.noOperationalItems" as MessageKey,
                  )}
                </p>
              </div>
            )}
          </TrackingSection>
          <TrackingSection
            title={resolveAppMessage(
              "pages.workspace.tracking.untrusted" as MessageKey,
            )}
          >
            {data.untrustedProjections.length ? (
              <div className="flex flex-col gap-3">
                {data.untrustedProjections.map((item) => (
                  <article
                    key={`${item.assessmentId}-${item.untrustedReason}`}
                    className="rounded-lg border p-3"
                  >
                    <p className="font-medium">{item.name}</p>
                    <p className="mt-1 text-sm">
                      {untrustedReasonMessage(item.untrustedReason)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTrackingDate(item.detectedAt)}
                    </p>
                    <Collapsible className="mt-2 text-sm">
                      <CollapsibleTrigger className="w-full justify-between">
                        {resolveAppMessage(
                          "pages.workspace.tracking.detail" as MessageKey,
                        )}
                        <ChevronDownIcon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
                        />
                      </CollapsibleTrigger>
                      <CollapsiblePanel>
                        <dl className="mt-2 space-y-1 text-xs">
                          <TrackingFact
                            label={resolveAppMessage(
                              "pages.workspace.tracking.detectedAt" as MessageKey,
                            )}
                            value={formatTrackingDate(item.detectedAt)}
                          />
                        </dl>
                      </CollapsiblePanel>
                    </Collapsible>
                    <p
                      className="mt-3 text-sm text-muted-foreground"
                      role="status"
                    >
                      {resolveAppMessage(
                        "pages.workspace.tracking.investigationUnavailable" as MessageKey,
                      )}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <Empty />
            )}
          </TrackingSection>
        </>
      ) : null}
      <OperationsEventDetailDialog
        event={selectedEvent}
        closeLabel={resolveAppMessage("pages.admin.billing.actions.close" as MessageKey)}
        labels={{
          area: resolveAppMessage("pages.workspace.tracking.anomaly" as MessageKey),
          status: resolveAppMessage("pages.workspace.tracking.executionState" as MessageKey),
          timestamp: resolveAppMessage("pages.workspace.tracking.updatedAt" as MessageKey),
          target: resolveAppMessage("pages.workspace.tracking.affectedCustomer" as MessageKey),
          summary: resolveAppMessage("pages.workspace.tracking.detail" as MessageKey),
        }}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}

function Empty() {
  return (
    <TrackingEmptyState>
      {resolveAppMessage(
        "pages.workspace.tracking.noOperationalItems" as MessageKey,
      )}
    </TrackingEmptyState>
  );
}

function untrustedReasonMessage(reason: TrackingUntrustedReason) {
  return resolveAppMessage(
    `pages.workspace.tracking.untrustedReason.${reason}` as MessageKey,
  );
}

function ModelUsageCard({ summary }: { summary: ModelUsageSummary }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <article className="rounded-lg border bg-card transition-colors hover:border-foreground/20">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-foreground">
              {summary.model}
            </span>
            <Badge
              variant={summary.unreconciledCount > 0 ? "secondary" : "outline"}
              className={
                summary.unreconciledCount === 0
                  ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : undefined
              }
            >
              {summary.unreconciledCount > 0
                ? `${resolveAppMessage(
                    "pages.workspace.tracking.unreconciled" as MessageKey,
                  )} (${summary.unreconciledCount})`
                : resolveAppMessage(
                    "pages.workspace.tracking.reconciled" as MessageKey,
                  )}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {summary.runCount}{" "}
              {resolveAppMessage(
                "pages.workspace.tracking.runsUnit" as MessageKey,
              )}
            </span>
            <span>·</span>
            <span>
              {resolveAppMessage(
                "pages.workspace.tracking.totalTokens" as MessageKey,
              )}
              :{" "}
              <span className="font-semibold text-foreground">
                {summary.totalTokens !== null
                  ? summary.totalTokens.toLocaleString(appLocale)
                  : "—"}
              </span>
            </span>
            {summary.promptTokens !== null ||
            summary.completionTokens !== null ? (
              <>
                <span>·</span>
                <span>
                  ({summary.promptTokens?.toLocaleString(appLocale) ?? "—"} in /{" "}
                  {summary.completionTokens?.toLocaleString(appLocale) ?? "—"} out)
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            {resolveAppMessage(
              (isOpen
                ? "pages.workspace.tracking.hideActivities"
                : "pages.workspace.tracking.viewActivities") as MessageKey,
            )}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              isOpen && "rotate-180",
            )}
          />
        </div>
      </button>
      {isOpen ? (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {resolveAppMessage(
              "pages.workspace.tracking.activities" as MessageKey,
            )}
          </p>
          <div className="space-y-2">
            {summary.items.map((item) => (
              <div
                key={item.eventId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {formatTrackingDate(item.createdAt)}
                  </span>
                  <Badge
                    variant={item.reconciled ? "outline" : "secondary"}
                    className={
                      item.reconciled
                        ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : undefined
                    }
                  >
                    {resolveAppMessage(
                      (item.reconciled
                        ? "pages.workspace.tracking.reconciled"
                        : "pages.workspace.tracking.unreconciled") as MessageKey,
                    )}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <span>
                    {resolveAppMessage(
                      "pages.workspace.tracking.totalTokens" as MessageKey,
                    )}
                    :{" "}
                    <span className="font-medium">
                      {item.totalTokens !== null
                        ? item.totalTokens.toLocaleString(appLocale)
                        : "—"}
                    </span>
                  </span>
                  {item.promptTokens !== null ||
                  item.completionTokens !== null ? (
                    <span className="text-muted-foreground">
                      ({item.promptTokens?.toLocaleString(appLocale) ?? "—"} in /{" "}
                      {item.completionTokens?.toLocaleString(appLocale) ?? "—"} out)
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
