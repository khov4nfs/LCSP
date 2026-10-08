import { LEGACY_ARTIFACT_AVAILABILITIES } from "@lcsp/contracts/legacy-migration";

import { buttonVariants } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";

import {
  LEGACY_AVAILABILITY_DETAIL_KEYS,
  LEGACY_AVAILABILITY_LABEL_KEYS,
  legacyDocumentTypeKey,
} from "../../config/legacy-archive-messages";
import type { LegacyArchiveReportRowProps } from "../../types/legacy-archive.types";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));

/** One archived report: its honest availability, and a download only for a preserved original. */
export function LegacyArchiveReportRow({
  assessmentId,
  report,
}: LegacyArchiveReportRowProps) {
  const downloadable =
    report.availability === LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE;
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border p-4"
      data-availability={report.availability}
      data-record-id={report.recordId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {resolveAppMessage(legacyDocumentTypeKey(report.documentType))}
        </span>
        <span className="text-sm">
          {resolveAppMessage(
            LEGACY_AVAILABILITY_LABEL_KEYS[report.availability],
          )}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {resolveAppMessage(
          LEGACY_AVAILABILITY_DETAIL_KEYS[report.availability],
        )}
      </p>
      {report.requestedAt ? (
        <p className="text-xs text-muted-foreground">
          {resolveAppMessage("pages.legacyArchive.requestedOn")}:{" "}
          {formatDate(report.requestedAt)}
        </p>
      ) : null}
      {downloadable ? (
        <>
          {report.sizeBytes !== null && report.contentSha256 ? (
            <p className="text-xs text-muted-foreground">
              {resolveAppMessage("pages.legacyArchive.size")}:{" "}
              {report.sizeBytes} B ·{" "}
              {resolveAppMessage("pages.legacyArchive.integrity")}:{" "}
              <span className="break-all font-mono">
                {report.contentSha256}
              </span>
            </p>
          ) : null}
          <a
            className={buttonVariants({ className: "w-fit" })}
            href={`/api/legacy-archive/assessments/${encodeURIComponent(assessmentId)}/reports/${encodeURIComponent(report.recordId)}/download`}
          >
            {resolveAppMessage("pages.legacyArchive.download")}
          </a>
        </>
      ) : null}
    </li>
  );
}
