"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { PRICING_ASSIGNMENT_STATUSES } from "@lcsp/contracts/billing";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminModelPricingOverviewQuery } from "@/lib/api/admin-pricing-queries";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import {
  getAppLocaleSnapshot,
  subscribeToAppLocale,
} from "@/lib/locale";
import { AdminOverviewMetricCard } from "../atoms/admin-overview-metric-card";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { AdminPricingDetailDialog } from "../molecules/admin-pricing-detail-dialog";
import { AdminPricingFiltersForm } from "../molecules/admin-pricing-filters";
import { AdminPricingPostureBanner } from "../molecules/admin-pricing-posture-banner";
import { AdminPricingAllowlistTable } from "./admin-pricing-allowlist-table";
import { AdminPricingAssignmentsTable } from "./admin-pricing-assignments-table";
import { AdminPricingCoverageTable } from "./admin-pricing-coverage-table";
import { AdminPricingDraftsTable } from "./admin-pricing-drafts-table";
import { AdminPricingSnapshotsTable } from "./admin-pricing-snapshots-table";
import { DEFAULT_ADMIN_PRICING_FILTERS } from "../../config/admin-pricing.config";
import {
  toAdminPricingQuery,
  type AdminPricingFilters,
} from "../../schemas/admin-pricing.schema";
import {
  PRICING_DETAIL_KINDS,
  type PricingDetailTarget,
} from "../../types/admin-pricing.types";
import { filterAdminPricingOverview } from "../../utils/admin-pricing-format";

/**
 * Read-only Admin Model Pricing workbench orchestrating posture banner, KPIs,
 * RHF filter bar, precedence-ordered coverage, versioned assignments, drafts,
 * immutable snapshots, runtime allowlist, and detail inspection dialog.
 */
export function AdminPricingPage() {
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );

  const [filters, setFilters] = useState<AdminPricingFilters>(
    DEFAULT_ADMIN_PRICING_FILTERS,
  );
  const [inspectTarget, setInspectTarget] =
    useState<PricingDetailTarget | null>(null);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  const apiQuery = useMemo(() => toAdminPricingQuery(filters), [filters]);
  const { data, isLoading, isFetching, isError, refetch } =
    useAdminModelPricingOverviewQuery(apiQuery);

  const filtered = useMemo(() => {
    if (!data || isError) return null;
    return filterAdminPricingOverview(data, filters);
  }, [data, filters, isError]);

  const snapshotById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["snapshots"][number]>();
    if (!data) return map;
    for (const snapshot of data.snapshots) {
      map.set(snapshot.id, snapshot);
    }
    return map;
  }, [data]);

  function handleApplyFilters(nextFilters: AdminPricingFilters) {
    setCopiedNotice(null);
    setFilters(nextFilters);
  }

  function handleResetFilters() {
    setCopiedNotice(null);
    setFilters(DEFAULT_ADMIN_PRICING_FILTERS);
  }

  function handleCopyId(id: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(id).catch(() => undefined);
    }
    setCopiedNotice(
      formatAppMessage("pages.admin.pricing.statusAnnouncement.copiedId", {
        id,
      }),
    );
  }

  const coverageGapCount =
    data?.coverage.filter((row) => !row.hasCoverage).length ?? 0;
  const activeOrScheduledCount =
    data?.assignments.filter(
      (item) =>
        item.status === PRICING_ASSIGNMENT_STATUSES.active ||
        item.status === PRICING_ASSIGNMENT_STATUSES.scheduled,
    ).length ?? 0;

  const liveAnnouncement = copiedNotice
    ? copiedNotice
    : filtered
      ? filtered.hasActiveFilters
        ? formatAppMessage("pages.admin.pricing.statusAnnouncement.filtered", {
            coverageCount: filtered.coverage.length,
            assignmentCount: filtered.assignments.length,
          })
        : formatAppMessage("pages.admin.pricing.statusAnnouncement.loaded", {
            coverageCount: filtered.coverage.length,
            assignmentCount: filtered.assignments.length,
            draftCount: filtered.drafts.length,
            snapshotCount: filtered.snapshots.length,
          })
      : "";

  return (
    <div className="space-y-6" data-testid="admin-pricing-page">
      <AdminPageHeader
        title={resolveAppMessage("pages.admin.pricing.title")}
        description={resolveAppMessage("pages.admin.pricing.description")}
        actionSlot={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCwIcon aria-hidden="true" />
            <span>{resolveAppMessage("pages.admin.pricing.refresh")}</span>
          </Button>
        }
      />

      {/* Single atomic polite live region for filter counts, load confirmation, and copy feedback */}
      <div className="sr-only" aria-live="polite">
        {liveAnnouncement}
      </div>

      <AdminPricingFiltersForm
        filters={filters}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />

      {isLoading ? (
        <div
          className="space-y-4"
          role="status"
          aria-label={resolveAppMessage("pages.admin.pricing.loading")}
          data-testid="admin-pricing-loading"
        >
          <Skeleton className="h-20 w-full rounded-md" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : null}

      {isError ? (
        <Alert variant="destructive" data-testid="admin-pricing-error">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>
            {resolveAppMessage("pages.admin.pricing.errorTitle")}
          </AlertTitle>
          <AlertDescription>
            {resolveAppMessage("pages.admin.pricing.errorDescription")}
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
            >
              {resolveAppMessage("pages.admin.pricing.retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {data && filtered && !isError ? (
        <div className="space-y-8">
          <AdminPricingPostureBanner
            debitMode={data.debitMode}
            dbUtcNow={data.dbUtcNow}
            locale={locale}
          />

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminOverviewMetricCard
              label={resolveAppMessage(
                "pages.admin.pricing.metrics.allowlistedModels",
              )}
              value={data.allowlistedModels.length}
              subtitle={resolveAppMessage(
                "pages.admin.pricing.metrics.allowlistedSubtitle",
              )}
            />
            <AdminOverviewMetricCard
              label={resolveAppMessage(
                "pages.admin.pricing.metrics.coverageGaps",
              )}
              value={coverageGapCount}
              subtitle={resolveAppMessage(
                "pages.admin.pricing.metrics.coverageGapsSubtitle",
              )}
            />
            <AdminOverviewMetricCard
              label={resolveAppMessage(
                "pages.admin.pricing.metrics.activeAssignments",
              )}
              value={activeOrScheduledCount}
              subtitle={resolveAppMessage(
                "pages.admin.pricing.metrics.assignmentsSubtitle",
              )}
            />
            <AdminOverviewMetricCard
              label={resolveAppMessage(
                "pages.admin.pricing.metrics.draftsAndSnapshots",
              )}
              value={`${data.drafts.length} / ${data.snapshots.length}`}
              subtitle={resolveAppMessage(
                "pages.admin.pricing.metrics.draftsAndSnapshotsSubtitle",
              )}
            />
          </section>

          <AdminPricingCoverageTable
            rows={filtered.coverage}
            hasActiveFilters={filtered.hasActiveFilters}
            locale={locale}
            onResetFilters={handleResetFilters}
            onInspect={(item) =>
              setInspectTarget({ kind: PRICING_DETAIL_KINDS.coverage, item })
            }
            onCopyId={handleCopyId}
          />

          <AdminPricingAssignmentsTable
            assignments={filtered.assignments}
            hasActiveFilters={filtered.hasActiveFilters}
            locale={locale}
            onResetFilters={handleResetFilters}
            onInspect={(item) =>
              setInspectTarget({
                kind: PRICING_DETAIL_KINDS.assignment,
                item,
                snapshot: snapshotById.get(item.tariffSnapshotId) ?? null,
              })
            }
            onCopyId={handleCopyId}
          />

          <AdminPricingDraftsTable
            drafts={filtered.drafts}
            hasActiveFilters={filtered.hasActiveFilters}
            locale={locale}
            onResetFilters={handleResetFilters}
            onInspect={(item) =>
              setInspectTarget({ kind: PRICING_DETAIL_KINDS.draft, item })
            }
            onCopyId={handleCopyId}
          />

          <AdminPricingSnapshotsTable
            snapshots={filtered.snapshots}
            hasActiveFilters={filtered.hasActiveFilters}
            locale={locale}
            onResetFilters={handleResetFilters}
            onInspect={(item) =>
              setInspectTarget({ kind: PRICING_DETAIL_KINDS.snapshot, item })
            }
            onCopyId={handleCopyId}
          />

          <AdminPricingAllowlistTable models={data.allowlistedModels} />
        </div>
      ) : null}

      <AdminPricingDetailDialog
        target={inspectTarget}
        locale={locale}
        onClose={() => setInspectTarget(null)}
        onCopyId={handleCopyId}
      />
    </div>
  );
}
