"use client";
import { useState } from "react";
import type { MessageKey } from "@lcsp/i18n";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { useAppLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { useLocalizationBacklogQuery } from "@/lib/api/localization-admin-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { ReviewStatusBadge } from "../atoms/review-status-badge";
import { LocalizationScopeReview } from "./localization-scope-review";

/**
 * Business purpose: Discover pending localization scopes and operational metrics without requiring a hidden scopeId.
 * Business rules:
 * - Displays backlog counts, oldest pending age, retry/failure counts, worker/provider readiness and per-scope readiness.
 * Execution flow:
 * 1. Query the Admin localization backlog endpoint and render summary metrics and scope list.
 * 2. Allow the administrator to inspect and review any discovered scope directly.
 * Failure cases:
 * - Query errors display an unavailable alert without inventing readiness.
 * Side effects:
 * - Performs one authenticated BFF backlog read and mounts the selected scope review workflow on demand.
 */
export function LocalizationOperationsQueue() {
  useAppLocale();
  const t = (key: string) =>
    resolveAppMessage(`pages.localizationReview.${key}` as MessageKey);
  const [cursors, setCursors] = useState<string[]>([]);
  const backlog = useLocalizationBacklogQuery(cursors.at(-1));
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);

  if (backlog.isPending) return <p>{t("loading")}</p>;
  if (backlog.isError || !backlog.data)
    return <p role="alert">{t("unavailable")}</p>;

  const { operations, scopes } = backlog.data;
  const activeScopeId = scopes.some(
    (scope) => scope.scopeId === selectedScopeId,
  )
    ? selectedScopeId
    : null;

  return (
    <section
      className="flex flex-col gap-4 rounded-md border p-4"
      data-slot="localization-operations-queue"
    >
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NextMetricCard
          variant={NEXT_METRIC_VARIANTS.embedded}
          label={t("pendingJobs")}
          value={operations.pendingJobCount}
          context={`${t("oldestPendingSeconds")}: ${operations.oldestPendingAgeSeconds}`}
        />
        <NextMetricCard
          variant={
            operations.sourceReviewsAwaitingAction > 0
              ? NEXT_METRIC_VARIANTS.attention
              : NEXT_METRIC_VARIANTS.ready
          }
          label={t("sourceReviewsAwaiting")}
          value={operations.sourceReviewsAwaitingAction}
          context={`${t("retries")}: ${operations.retryCount}`}
        />
        <NextMetricCard
          variant={
            operations.candidateReviewsAwaitingAction > 0
              ? NEXT_METRIC_VARIANTS.attention
              : NEXT_METRIC_VARIANTS.ready
          }
          label={t("outputReviewsAwaiting")}
          value={operations.candidateReviewsAwaitingAction}
          context={`${t("workerEnabled")}: ${operations.workerEnabled ? t("yes") : t("no")}`}
        />
        <NextMetricCard
          variant={
            operations.failedJobCount > 0
              ? NEXT_METRIC_VARIANTS.attention
              : NEXT_METRIC_VARIANTS.ready
          }
          label={t("failedJobs")}
          value={operations.failedJobCount}
          context={`${t("providerConfigured")}: ${operations.providerConfigured ? t("yes") : t("no")}`}
        />
      </div>
      {scopes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {scopes.map((scope) => (
            <li
              key={scope.scopeId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs font-semibold">
                  {scope.scopeId}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{scope.entityTypes.join(", ")}</span>
                  <span>·</span>
                  <span>{t("readinessEn")}:</span>
                  <ReviewStatusBadge status={scope.readiness.en} />
                  <span>·</span>
                  <span>{t("readinessVi")}:</span>
                  <ReviewStatusBadge status={scope.readiness.vi} />
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedScopeId(scope.scopeId)}
              >
                {t("selectScope")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          disabled={!cursors.length}
          onClick={() => {
            setSelectedScopeId(null);
            setCursors((current) => current.slice(0, -1));
          }}
        >
          {t("previousPage")}
        </Button>
        <Button
          disabled={!backlog.data.hasMore}
          onClick={() => {
            setSelectedScopeId(null);
            setCursors((current) => [
              ...current,
              backlog.data!.nextAfterScopeId!,
            ]);
          }}
        >
          {t("nextPage")}
        </Button>
      </div>
      {activeScopeId ? (
        <LocalizationScopeReview key={activeScopeId} scopeId={activeScopeId} />
      ) : null}
    </section>
  );
}
