"use client";

import type { TrackingUntrustedReason } from "@lcsp/contracts/assessment-domain";
import type { MessageKey } from "@lcsp/i18n";
import { ChevronDownIcon } from "lucide-react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackingSection } from "../molecules/tracking-section";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { TrackingFact } from "../molecules/tracking-fact";
import { TrackingMetric } from "../molecules/tracking-metric";
import { appLocale } from "@/lib/locale";
import { useAdminTrackingOperationalQuery } from "@/lib/api/tracking-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { formatTrackingDate } from "../../utils/tracking-display";
import { TrackingError } from "../molecules/tracking-error";

export function AdminTrackingPage() {
  const query = useAdminTrackingOperationalQuery();
  const data = query.data;
  return (
    <div className="space-y-6">
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
            <TrackingMetric
              label={resolveAppMessage(
                "pages.workspace.tracking.failedAssessments" as MessageKey,
              )}
              value={data.platformHealth.totalFailedAssessments}
            />
            <TrackingMetric
              label={resolveAppMessage(
                "pages.workspace.tracking.blockedAssessments" as MessageKey,
              )}
              value={data.platformHealth.totalBlockedAssessments}
            />
            <TrackingMetric
              label={resolveAppMessage(
                "pages.workspace.tracking.executions" as MessageKey,
              )}
              value={data.platformHealth.totalExecutionAnomalies}
            />
            <TrackingMetric
              label={resolveAppMessage(
                "pages.workspace.tracking.usage" as MessageKey,
              )}
              value={data.platformHealth.totalUnreconciledUsageEvents}
            />
            <TrackingMetric
              label={resolveAppMessage(
                "pages.workspace.tracking.untrusted" as MessageKey,
              )}
              value={data.platformHealth.totalUntrustedProjections}
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
                    <p className="font-medium">{item.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {resolveAppMessage(
                        "pages.workspace.tracking.affectedCustomer" as MessageKey,
                      )}
                      : {item.ownerId}
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
          <div className="grid gap-6 xl:grid-cols-2">
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
                      className="rounded-lg border p-3"
                    >
                      <p className="font-medium">{item.assessmentId}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.anomalyType}
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
                                "pages.workspace.tracking.executionState" as MessageKey,
                              )}
                              value={item.executionState}
                            />
                            <TrackingFact
                              label={resolveAppMessage(
                                "pages.workspace.tracking.duration" as MessageKey,
                              )}
                              value={
                                item.durationSeconds === null
                                  ? ""
                                  : `${item.durationSeconds} ${resolveAppMessage("pages.workspace.tracking.secondsUnit" as MessageKey)}`
                              }
                            />
                            <TrackingFact
                              label={resolveAppMessage(
                                "pages.workspace.tracking.runtimeVersion" as MessageKey,
                              )}
                              value={item.rootAgentVersion ?? ""}
                            />
                            <TrackingFact
                              label={resolveAppMessage(
                                "pages.workspace.tracking.generatedAt" as MessageKey,
                              )}
                              value={formatTrackingDate(item.detectedAt)}
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
                  {data.unreconciledUsage.map((item) => (
                    <article
                      key={item.eventId}
                      className="rounded-lg border p-3"
                    >
                      <p className="font-medium">
                        {item.assessmentId ?? item.eventId}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {resolveAppMessage(
                          "pages.workspace.tracking.model" as MessageKey,
                        )}
                        : {item.model}
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
                                "pages.workspace.tracking.tokenCount" as MessageKey,
                              )}
                              value={
                                item.totalTokens?.toLocaleString(appLocale) ??
                                ""
                              }
                            />
                            <TrackingFact
                              label={resolveAppMessage(
                                "pages.workspace.tracking.generatedAt" as MessageKey,
                              )}
                              value={formatTrackingDate(item.createdAt)}
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
          </div>
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
                              "pages.workspace.tracking.assessmentIdLabel" as MessageKey,
                            )}
                            value={item.assessmentId}
                          />
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
