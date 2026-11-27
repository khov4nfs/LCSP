"use client";

import { useMemo, useState } from "react";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";
import { SearchIcon } from "lucide-react";

import {
  COLLECTION_METRIC_TONES,
  COLLECTION_METRIC_VARIANTS,
  CollectionMetricCard,
} from "@/components/molecules/collection-metric-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { useLegalSourceListQuery } from "@/lib/api/legal-source-queries";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { LegalSourceCreateDialog } from "../molecules/legal-source-create-dialog";
import { LegalSourceListCard } from "../molecules/legal-source-list-card";

const t = (key: string) => resolveAppMessage(key as MessageKey);

const SOURCE_FILTERS = {
  all: "all",
  active: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
  draft: LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
  unconfigured: "unconfigured",
} as const;

type SourceFilter = (typeof SOURCE_FILTERS)[keyof typeof SOURCE_FILTERS];

/**
 * Business purpose: Render the admin legal sources catalog with collection spotlight metrics, search/lifecycle filters, and source creation controls.
 * Business rules:
 * - Displays real query loading, error/retry, and empty states without fabricating legal source records.
 * - Filters displayed sources client-side by name, slug, description, and active/draft lifecycle status.
 * Execution flow:
 * 1. Fetch legal source summaries via useLegalSourceListQuery.
 * 2. Compute active, open-draft, and unconfigured counts for CollectionMetricCard strip.
 * 3. Filter items by search query and active filter chip, then render LegalSourceListCard grid.
 * Failure cases:
 * - Query errors display a destructive alert with retry action; empty filter results show a resettable empty state.
 * Side effects:
 * - Executes read-only list query and opens LegalSourceCreateDialog on demand.
 */
export function LegalSourcesPage() {
  const sources = useLegalSourceListQuery();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<SourceFilter>(
    SOURCE_FILTERS.all,
  );

  const items = useMemo(
    () => sources.data?.items ?? [],
    [sources.data?.items],
  );

  const counts = useMemo(() => {
    let active = 0;
    let draft = 0;
    let unconfigured = 0;
    for (const item of items) {
      if (item.activeVersion !== null) active += 1;
      else if (
        item.latestVersion?.status === LEGAL_SOURCE_LIFECYCLE_STATUSES.draft
      ) {
        draft += 1;
      } else {
        unconfigured += 1;
      }
    }
    return { total: items.length, active, draft, unconfigured };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const hasActive = item.activeVersion !== null;
      const hasDraftOnly =
        !hasActive &&
        item.latestVersion?.status === LEGAL_SOURCE_LIFECYCLE_STATUSES.draft;
      if (activeFilter === SOURCE_FILTERS.active && !hasActive) {
        return false;
      }
      if (activeFilter === SOURCE_FILTERS.draft && !hasDraftOnly) {
        return false;
      }
      if (
        activeFilter === SOURCE_FILTERS.unconfigured &&
        (hasActive || hasDraftOnly)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.slug.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [activeFilter, items, searchQuery]);

  if (sources.isPending) return <Skeleton className="h-72 w-full" />;
  if (sources.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("pages.legalSources.loadFailed")}</span>
          <Button variant="outline" onClick={() => void sources.refetch()}>
            {t("pages.legalSources.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12" data-component="LegalSourcesPage">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <AdminPageHeader
          title={t("pages.legalSources.listTitle")}
          description={t("pages.legalSources.listDescription")}
        />
        <LegalSourceCreateDialog />
      </div>

      <section
        aria-label={t("pages.legalSources.listTitle")}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
      >
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.spotlight}
          label={t("pages.legalSources.listTitle")}
          value={counts.total}
          context={t("pages.legalSources.versionsTitle")}
          segments={[
            {
              key: "active",
              count: counts.active,
              toneClassName: "bg-bento-accent",
            },
            {
              key: "draft",
              count: counts.draft,
              toneClassName: "bg-status-warning",
            },
            {
              key: "unconfigured",
              count: counts.unconfigured,
              toneClassName: "bg-muted-foreground/50",
            },
          ]}
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.success}
          label={t("pages.legalSources.statuses.ACTIVE")}
          value={counts.active}
          context={t("pages.legalSources.activeVersionLabel")}
          isActive={activeFilter === SOURCE_FILTERS.active}
          onClick={() =>
            setActiveFilter((prev) =>
              prev === SOURCE_FILTERS.active
                ? SOURCE_FILTERS.all
                : SOURCE_FILTERS.active,
            )
          }
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.warning}
          label={t("pages.legalSources.statuses.DRAFT")}
          value={counts.draft}
          context={t("pages.legalSources.openDraftVersion")}
          isActive={activeFilter === SOURCE_FILTERS.draft}
          onClick={() =>
            setActiveFilter((prev) =>
              prev === SOURCE_FILTERS.draft
                ? SOURCE_FILTERS.all
                : SOURCE_FILTERS.draft,
            )
          }
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.muted}
          label={t("pages.legalSources.noVersions")}
          value={counts.unconfigured}
          context={t("pages.legalSources.listTitle")}
          isActive={activeFilter === SOURCE_FILTERS.unconfigured}
          onClick={() =>
            setActiveFilter((prev) =>
              prev === SOURCE_FILTERS.unconfigured
                ? SOURCE_FILTERS.all
                : SOURCE_FILTERS.unconfigured,
            )
          }
        />
      </section>

      {items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:max-w-sm">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={t("pages.legalSources.searchPlaceholder")}
              aria-label={t("pages.legalSources.searchPlaceholder")}
              className="pl-9"
            />
          </div>
          {activeFilter !== SOURCE_FILTERS.all || searchQuery.trim() !== "" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveFilter(SOURCE_FILTERS.all);
                setSearchQuery("");
              }}
            >
              {t("pages.admin.billing.filters.all")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {filteredItems.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((source) => (
            <LegalSourceListCard key={source.id} source={source} />
          ))}
        </div>
      ) : (
        <section className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">
            {t("pages.legalSources.emptyTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            {t("pages.legalSources.emptyDescription")}
          </p>
        </section>
      )}
    </div>
  );
}
