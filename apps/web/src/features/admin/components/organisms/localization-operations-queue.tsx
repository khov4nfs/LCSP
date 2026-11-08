"use client";
import { useState } from "react";
import type { MessageKey } from "@lcsp/i18n";
import { useAppLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { useLocalizationBacklogQuery } from "@/lib/api/localization-admin-queries";
import { resolveAppMessage } from "@/lib/i18n";
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
  const backlog = useLocalizationBacklogQuery();
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);

  if (backlog.isPending) return <p>{t("loading")}</p>;
  if (backlog.isError || !backlog.data)
    return <p role="alert">{t("unavailable")}</p>;

  const { operations, scopes } = backlog.data;
  const activeScopeId = selectedScopeId ?? scopes[0]?.scopeId ?? null;

  return (
    <section
      className="flex flex-col gap-4 rounded-md border p-4"
      data-slot="localization-operations-queue"
    >
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("pendingJobs")}</dt>
          <dd className="font-semibold">{operations.pendingJobCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("oldestPendingSeconds")}
          </dt>
          <dd className="font-semibold">
            {operations.oldestPendingAgeSeconds}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("retries")}</dt>
          <dd className="font-semibold">{operations.retryCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("failedJobs")}</dt>
          <dd className="font-semibold">{operations.failedJobCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("sourceReviewsAwaiting")}
          </dt>
          <dd className="font-semibold">
            {operations.sourceReviewsAwaitingAction}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("outputReviewsAwaiting")}
          </dt>
          <dd className="font-semibold">
            {operations.candidateReviewsAwaitingAction}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("workerEnabled")}
          </dt>
          <dd className="font-semibold">
            {operations.workerEnabled ? t("yes") : t("no")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("providerConfigured")}
          </dt>
          <dd className="font-semibold">
            {operations.providerConfigured ? t("yes") : t("no")}
          </dd>
        </div>
      </dl>
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
                <span className="text-xs text-muted-foreground">
                  {scope.entityTypes.join(", ")} · {t("readinessEn")}:{" "}
                  {scope.readiness.en} · {t("readinessVi")}:{" "}
                  {scope.readiness.vi}
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
      {activeScopeId ? (
        <LocalizationScopeReview scopeId={activeScopeId} />
      ) : null}
    </section>
  );
}
