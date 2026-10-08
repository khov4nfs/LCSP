"use client";
import { LEGACY_MIGRATION_ERROR_CODES } from "@lcsp/contracts/legacy-migration";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLegacyArchiveDetailQuery } from "@/lib/api/legacy-archive-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";

import { legacyStatusKey } from "../../config/legacy-archive-messages";
import type { LegacyArchivePanelProps } from "../../types/legacy-archive.types";
import { LegacyArchiveReportRow } from "../molecules/legacy-archive-report-row";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));

/**
 * Shown where the canonical assessment view has nothing to show: an assessment completed on the
 * previous platform. It is read-only history; a non-archived assessment keeps the old message.
 */
export function LegacyArchivePanel({ assessmentId }: LegacyArchivePanelProps) {
  const archive = useLegacyArchiveDetailQuery(assessmentId);
  if (archive.isPending)
    return (
      <p className="p-6" role="status">
        {resolveAppMessage("pages.legacyArchive.loading")}
      </p>
    );
  if (archive.isError) {
    if (
      archive.error.message === LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_NOT_FOUND
    )
      return (
        <p className="p-6">
          {resolveAppMessage("pages.legacyArchive.notArchived")}
        </p>
      );
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {resolveAppMessage("pages.legacyArchive.requestFailed")}{" "}
          <Button variant="outline" onClick={() => void archive.refetch()}>
            {resolveAppMessage("pages.legacyArchive.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const detail = archive.data;
  const statusKey = legacyStatusKey(detail.legacy_status);
  return (
    <main
      className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-6"
      data-assessment-id={assessmentId}
      data-legacy-archive="true"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">{detail.name}</h1>
        <p className="text-sm text-muted-foreground">
          {resolveAppMessage("pages.legacyArchive.title")}
        </p>
        <Alert>
          <AlertDescription>
            {resolveAppMessage("pages.legacyArchive.readOnlyNotice")}
          </AlertDescription>
        </Alert>
        <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {statusKey ? (
            <div>
              <dt className="text-muted-foreground">
                {resolveAppMessage("pages.legacyArchive.legacyStatus")}
              </dt>
              <dd>{resolveAppMessage(statusKey)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">
              {resolveAppMessage("pages.legacyArchive.lastUpdated")}
            </dt>
            <dd>{formatDate(detail.legacy_updated_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {resolveAppMessage("pages.legacyArchive.archivedOn")}
            </dt>
            <dd>{formatDate(detail.archived_at)}</dd>
          </div>
        </dl>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          {resolveAppMessage("pages.legacyArchive.reportsHeading")}
        </h2>
        {detail.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {resolveAppMessage("pages.legacyArchive.noReports")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.reports.map((report) => (
              <LegacyArchiveReportRow
                key={report.recordId}
                assessmentId={assessmentId}
                report={report}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
