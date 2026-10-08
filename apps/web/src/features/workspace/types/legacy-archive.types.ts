import type { LegacyArchiveReportItem } from "@lcsp/contracts/legacy-migration";

export type LegacyArchiveReportRowProps = {
  assessmentId: string;
  report: LegacyArchiveReportItem;
};

export type LegacyArchivePanelProps = {
  assessmentId: string;
};
