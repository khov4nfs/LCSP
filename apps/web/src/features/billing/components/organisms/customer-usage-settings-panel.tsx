"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useState } from "react";

import { useHydrated } from "@/components/hooks/use-hydrated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { isCustomerUsageForbidden } from "@/lib/api/customer-usage-client";
import { useCustomerUsageQuery } from "@/lib/api/customer-usage-queries";

import type { CustomerUsagePanelProps } from "../../types/customer-usage.types";
import {
  customerUsagePeriod,
  formatUsageDateTime,
} from "../../utils/customer-usage";
import { CustomerUsageBreakdown } from "../molecules/customer-usage-breakdown";
import { CustomerUsageSummary } from "../molecules/customer-usage-summary";
import { CustomerUsageFiltersForm } from "./customer-usage-filters";
import { CustomerUsageHistory } from "./customer-usage-history";

export function CustomerUsageSettingsPanel({
  locale,
  onOpenBilling,
}: CustomerUsagePanelProps) {
  const hydrated = useHydrated();
  const [query, setQuery] = useState(() => customerUsagePeriod());
  const result = useCustomerUsageQuery(query);
  const forbidden = isCustomerUsageForbidden(result.error);
  const report = hydrated && !result.isError ? result.data : undefined;
  return (
    <section
      className="h-full min-h-0 min-w-0 space-y-6 overflow-y-auto p-4 sm:p-8"
      data-component="CustomerUsageSettingsPanel"
      aria-labelledby="customer-usage-heading"
      aria-busy={result.isFetching}
    >
      <header className="space-y-2">
        <h2 id="customer-usage-heading" className="text-lg font-semibold">
          {resolveMessage(locale, "pages.workspace.settingsHub.usage.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.usage.description",
          )}
        </p>
        <Button
          type="button"
          variant="link"
          className="h-auto whitespace-normal p-0 text-left"
          onClick={onOpenBilling}
        >
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.usage.billingLink",
          )}
        </Button>
      </header>
      <p className="text-xs text-muted-foreground">
        {resolveMessage(locale, "pages.workspace.settingsHub.usage.utcNotice")}
      </p>
      <CustomerUsageFiltersForm
        locale={locale}
        query={query}
        onApply={setQuery}
      />
      <Button
        type="button"
        variant="outline"
        disabled={!hydrated || result.isFetching || forbidden}
        onClick={() => void result.refetch()}
      >
        {resolveMessage(locale, "pages.workspace.settingsHub.usage.refresh")}
      </Button>
      {!hydrated || result.isPending ? (
        <p role="status">
          {resolveMessage(locale, "pages.workspace.settingsHub.usage.loading")}
        </p>
      ) : result.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-2">
            <p>
              {resolveMessage(
                locale,
                forbidden
                  ? "pages.workspace.settingsHub.usage.forbidden"
                  : "pages.workspace.settingsHub.usage.loadFailed",
              )}
            </p>
            {!forbidden ? (
              <Button
                type="button"
                variant="outline"
                disabled={result.isFetching}
                onClick={() => void result.refetch()}
              >
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.retry",
                )}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {hydrated && result.isFetching && !result.isPending ? (
        <p role="status">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.usage.refreshing",
          )}
        </p>
      ) : null}
      {report ? (
        <>
          <p className="text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.usage.reportedAt",
            ).replace(
              "{time}",
              formatUsageDateTime(result.dataUpdatedAt, locale),
            )}
          </p>
          {report.totalCount === 0 ? (
            <Empty role="status" className="border">
              <EmptyHeader>
                <EmptyTitle>
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.usage.empty",
                  )}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <CustomerUsageSummary
                locale={locale}
                summary={report.summary}
                sellingPrice={report.sellingPrice}
              />
              <CustomerUsageBreakdown
                locale={locale}
                rows={report.breakdowns}
              />
            </>
          )}
          <CustomerUsageHistory
            locale={locale}
            report={report}
            disabled={result.isFetching}
            onPageChange={(page) => setQuery({ ...query, page })}
          />
        </>
      ) : null}
    </section>
  );
}
